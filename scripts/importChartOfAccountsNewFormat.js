const fs = require('fs');
const path = require('path');
const db = require('../config/database');

/**
 * Import Chart of Accounts from CSV file (New Format)
 * 
 * This script handles the new hierarchical format with:
 * - Primary account codes (3-digit: 110, 170, 230, etc.)
 * - Sub-account codes (2-3 digit: 25, 32, 44, etc.)
 * - Full account codes in format: XXX-XXX-XXX-XXX-XX
 * - Categor Location mapping columns
 * 
 * Usage:
 *   node scripts/importChartOfAccountsNewFormat.js <path-to-csv-file>
 * 
 * CSV Format Expected (New Format):
 *   Primary Code,Sub Code,Description,Active Status,Categor Location Col1,Col2,Col3,Col4,Col5
 *   110,25,Fixed assets - computer equipment,Yes,111,101,110,25,44
 *   110,32,Fixed assets - office equipment,Yes,111,101,110,32,44
 */

function inferCategory(primaryCode, description) {
  const code = String(primaryCode || '').trim();
  const desc = (description || '').toUpperCase();
  
  // Based on primary account codes
  if (code.startsWith('110') || code.startsWith('230')) return 'BS'; // Property, Plant & Equipment, Right of Use Assets
  if (code.startsWith('170') || code.startsWith('350')) return 'BS'; // Financial Assets
  if (code.startsWith('290')) return 'BS'; // Prepayments & Receivables
  if (code.startsWith('410')) return 'BS'; // Cash and Short Term Deposits
  
  // Based on description
  if (/ASSET|CASH|BANK|DEPOSIT|RECEIVABLE|INVESTMENT|BOND|TREASURY/i.test(desc)) return 'BS';
  if (/LIABILITY|PAYABLE|LOAN|BORROWING/i.test(desc)) return 'BS';
  if (/INCOME|REVENUE|INTEREST.*INCOME|FEE/i.test(desc)) return 'PL';
  if (/EXPENSE|COST|INTEREST.*EXPENSE/i.test(desc)) return 'PL';
  
  return 'BS'; // Default
}

function inferAccountType(primaryCode, description) {
  const code = String(primaryCode || '').trim();
  const desc = (description || '').toUpperCase();
  
  // Map based on primary account codes
  if (code === '110') return 'Fixed Assets'; // Property, Plant & Equipment
  if (code === '170') return 'Investments'; // Financial Assets at amortised cost
  if (code === '230') return 'Fixed Assets'; // Right of Use Assets
  if (code === '290') return 'Accounts Receivable'; // Prepayments & Receivables
  if (code === '350') return 'Investments'; // Financial Assets
  if (code === '410') return 'Cash and Cash Equivalents'; // Cash and Short Term Deposits
  
  // Map based on description patterns
  if (/CASH|BANK|CURRENT ACCOUNT|SAVINGS|DEPOSIT/i.test(desc)) return 'Cash and Cash Equivalents';
  if (/TREASURY.*BOND|BOND.*TREASURY|TBOND|GSEC/i.test(desc)) return 'Investments';
  if (/TREASURY.*BILL|TBILL/i.test(desc)) return 'Investments';
  if (/INVESTMENT|SECURITY|SHARE/i.test(desc)) return 'Investments';
  if (/RECEIVABLE|DEPOSIT.*RECEIVABLE|ADVANCE/i.test(desc)) return 'Accounts Receivable';
  if (/INTEREST.*RECEIVABLE|ACCRUED|COUPON/i.test(desc)) return 'Accounts Receivable';
  if (/REVALUATION|GAIN|LOSS/i.test(desc)) return 'Investments';
  if (/PAYABLE|LIABILITY|LOAN/i.test(desc)) return 'Accounts Payable';
  if (/INTEREST.*INCOME|INCOME.*INTEREST/i.test(desc)) return 'Interest Income';
  if (/INTEREST.*EXPENSE|EXPENSE.*INTEREST/i.test(desc)) return 'Interest Expenses';
  if (/FEE|COMMISSION/i.test(desc)) return 'Fee Income';
  if (/EXPENSE|COST/i.test(desc)) return 'Operating Expenses';
  
  return 'Other Assets'; // Default fallback
}

function buildFullAccountCode(primaryCode, subCode, categorLocation = null) {
  // If categorLocation is provided, use it to build the full code
  if (categorLocation && categorLocation.length >= 4) {
    // Format: XXX-XXX-XXX-XXX-XX
    // From categorLocation: [col1, col2, col3, col4, col5]
    // Example: [111, 101, 110, 25, 44] -> 111-101-110-025-44
    const parts = [
      String(categorLocation[0] || '').padStart(3, '0'),
      String(categorLocation[1] || '').padStart(3, '0'),
      String(categorLocation[2] || '').padStart(3, '0'),
      String(categorLocation[3] || '').padStart(3, '0'),
      String(categorLocation[4] || '44').padStart(2, '0')
    ];
    return parts.join('-');
  }
  
  // Fallback: build from primary and sub codes
  // Format: 1-XXX-XX-XX-XX (assuming first part is 1 for ASSETS)
  const primary = String(primaryCode || '').padStart(3, '0');
  const sub = String(subCode || '').padStart(2, '0');
  return `1-${primary}-${sub}-01-01`;
}

async function importChartOfAccountsNewFormat(csvPath, options = {}) {
  const {
    deleteExisting = false,
    updateExisting = true,
    dryRun = false
  } = options;

  try {
    console.log('📋 Chart of Accounts Import Script (New Format)');
    console.log('================================================');
    console.log(`📁 CSV File: ${csvPath}`);
    console.log(`🗑️  Delete Existing: ${deleteExisting}`);
    console.log(`🔄 Update Existing: ${updateExisting}`);
    console.log(`🧪 Dry Run: ${dryRun}`);
    console.log('');

    // Check if file exists
    if (!fs.existsSync(csvPath)) {
      throw new Error(`CSV file not found: ${csvPath}`);
    }

    // 1. Delete existing accounts if requested
    if (deleteExisting && !dryRun) {
      console.log('⚠️  WARNING: This will delete all accounts and related mappings.');
      console.log('   Foreign key constraints will be temporarily disabled.');
      
      // Temporarily disable foreign key checks
      await db.query('SET FOREIGN_KEY_CHECKS = 0');
      
      try {
        // Delete in order: dependent tables first
        await db.query('DELETE FROM account_mappings');
        console.log('✅ Deleted all existing account mappings.');
        
        // Note: We're not deleting ledger_entries as they contain historical data
        // Instead, we'll update existing accounts or insert new ones
        await db.query('DELETE FROM chart_of_accounts');
        console.log('✅ Deleted all existing accounts.');
      } finally {
        // Re-enable foreign key checks
        await db.query('SET FOREIGN_KEY_CHECKS = 1');
      }
    }

    // 2. Read and parse CSV
    const raw = fs.readFileSync(csvPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = [];
    let headerFound = false;
    let headerIndex = -1;
    let parentAccounts = {}; // Store parent accounts for hierarchy

    // Get all account types for lookup
    const [accountTypes] = await db.query('SELECT id, name FROM account_types');
    const accountTypeMap = {};
    accountTypes.forEach(at => {
      accountTypeMap[at.name.toLowerCase()] = at.id;
    });

    console.log('📊 Processing CSV lines...\n');

    // First pass: Find header and understand structure
    for (let i = 0; i < lines.length; ++i) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Look for header row
      if (/Primary|Sub.*Code|Account.*Code|Description|Categor|Location/i.test(line)) {
        headerFound = true;
        headerIndex = i;
        console.log(`📋 Header found at line ${i + 1}`);
        console.log(`   ${line.substring(0, 100)}...`);
        break;
      }
    }

    if (!headerFound) {
      throw new Error('Could not find header row in CSV. Expected columns: Primary Code, Sub Code, Description, etc.');
    }

    // Second pass: Process data rows
    for (let i = headerIndex + 1; i < lines.length; ++i) {
      const line = lines[i].trim();
      
      // Skip empty lines
      if (!line || line.replace(/,/g, '').trim() === '') continue;
      
      // Skip section headers (lines that don't contain numbers in the right columns)
      if (!/[\d]/.test(line)) continue;
      
      // Parse CSV row (handle quoted fields)
      const parts = [];
      let currentPart = '';
      let inQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          parts.push(currentPart.trim());
          currentPart = '';
        } else {
          currentPart += char;
        }
      }
      parts.push(currentPart.trim()); // Add last part
      
      // Based on the CSV structure:
      // Column 0: Empty or category number
      // Column 1: Category name (ASSETS, etc.)
      // Column 2: Subcategory
      // Column 3: Primary Code (110, 170, 230, 290, 350, 410)
      // Column 4: Primary Description
      // Column 5: Sub Code (25, 32, 44, etc.)
      // Column 6: Sub Description (actual account description)
      // Column 7-12: Other columns
      // Column 13-17: Categor Location (111, 101, 110, 25, 44)
      
      if (parts.length < 7) continue; // Need at least up to description
      
      const primaryCode = parts[3] ? parts[3].trim() : '';
      const subCode = parts[5] ? parts[5].trim() : '';
      const description = parts[6] ? parts[6].trim() : '';
      const active = 'Yes'; // Default to Yes if not specified
      
      // Skip if primary code, sub code, or description is empty
      if (!primaryCode || !subCode || !description) {
        continue;
      }
      
      // Skip if primary code doesn't look like a number
      if (!/^\d+$/.test(primaryCode)) {
        continue;
      }
      
      // Extract categor location columns (columns 13-17, indices 12-16)
      const categorLocation = [];
      if (parts.length >= 17) {
        // Categor Location is in the last 5 columns
        for (let k = 12; k < Math.min(17, parts.length); k++) {
          const val = parts[k].trim();
          if (val && !isNaN(val)) {
            categorLocation.push(parseInt(val));
          }
        }
      }
      
      // If categor location not found, try to find it in any column
      if (categorLocation.length === 0) {
        for (let k = parts.length - 5; k < parts.length; k++) {
          if (k >= 0) {
            const val = parts[k].trim();
            if (val && !isNaN(val) && parseInt(val) > 0) {
              categorLocation.push(parseInt(val));
            }
          }
        }
      }
      
      // Build full account code
      const account_code = buildFullAccountCode(primaryCode, subCode, categorLocation.length > 0 ? categorLocation : null);
      
      const is_active = /yes|true|1|active/i.test(active);
      const category = inferCategory(primaryCode, description);
      const type = 'GL';
      
      // Find account_type_id
      const typeName = inferAccountType(primaryCode, description);
      let account_type_id = accountTypeMap[typeName.toLowerCase()];
      
      // If not found, try partial match
      if (!account_type_id) {
        for (const [typeNameKey, typeId] of Object.entries(accountTypeMap)) {
          if (typeName.toLowerCase().includes(typeNameKey) || typeNameKey.includes(typeName.toLowerCase())) {
            account_type_id = typeId;
            break;
          }
        }
      }
      
      // Fallback to first available account type
      if (!account_type_id && accountTypes.length > 0) {
        account_type_id = accountTypes[0].id;
        console.warn(`⚠️  Account ${account_code}: Using fallback account_type_id ${account_type_id} (${accountTypes[0].name})`);
      }
      
      if (!account_type_id) {
        errors.push(`Account ${account_code} (${description}): No account_type_id found`);
        skipped++;
        continue;
      }
      
      // Handle parent account (primary code level)
      let parent_account_id = null;
      // Build parent code by replacing the sub-code part with zeros
      let parentCode = '';
      if (categorLocation.length >= 4) {
        // Use categor location but set sub-code to 00
        parentCode = buildFullAccountCode(primaryCode, '00', [categorLocation[0], categorLocation[1], categorLocation[2], 0, categorLocation[4] || 44]);
      } else {
        // Fallback: build parent code
        parentCode = buildFullAccountCode(primaryCode, '00', null);
      }
      
      // Check if parent exists or create it
      if (subCode && subCode !== '00' && subCode !== '0' && parseInt(subCode) > 0) {
        const [parentExists] = await db.query(
          'SELECT id FROM chart_of_accounts WHERE account_code = ?',
          [parentCode]
        );
        
        if (parentExists.length === 0 && !dryRun) {
          // Create parent account
          const parentName = inferAccountType(primaryCode, '') + ' - ' + primaryCode;
          try {
            const [parentResult] = await db.query(
              `INSERT INTO chart_of_accounts 
               (account_code, name, is_active, category, type, account_type_id, created_at, updated_at) 
               VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
              [parentCode, parentName, true, category, type, account_type_id]
            );
            parent_account_id = parentResult.insertId;
            parentAccounts[parentCode] = parent_account_id;
            console.log(`📁 Created parent account: ${parentCode} - ${parentName}`);
          } catch (err) {
            // Parent might have been created by another row
            const [parentCheck] = await db.query(
              'SELECT id FROM chart_of_accounts WHERE account_code = ?',
              [parentCode]
            );
            if (parentCheck.length > 0) {
              parent_account_id = parentCheck[0].id;
              parentAccounts[parentCode] = parent_account_id;
            }
          }
        } else if (parentExists.length > 0) {
          parent_account_id = parentExists[0].id;
          parentAccounts[parentCode] = parent_account_id;
        }
      }
      
      try {
        if (dryRun) {
          console.log(`[DRY RUN] Would ${updateExisting ? 'insert/update' : 'insert'}: ${account_code} - ${description} (Parent: ${parentCode})`);
          inserted++;
        } else {
          // Check if account exists
          const [existing] = await db.query(
            'SELECT id FROM chart_of_accounts WHERE account_code = ?',
            [account_code]
          );
          
          if (existing.length > 0) {
            if (updateExisting) {
              await db.query(
                `UPDATE chart_of_accounts 
                 SET name = ?, is_active = ?, category = ?, type = ?, account_type_id = ?, 
                     parent_account_id = ?, updated_at = NOW()
                 WHERE account_code = ?`,
                [description, is_active, category, type, account_type_id, parent_account_id, account_code]
              );
              updated++;
              if (inserted % 50 === 0) console.log(`   Processed ${inserted + updated} accounts...`);
            } else {
              skipped++;
            }
          } else {
            await db.query(
              `INSERT INTO chart_of_accounts 
               (account_code, name, is_active, category, type, account_type_id, parent_account_id, created_at, updated_at) 
               VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
              [account_code, description, is_active, category, type, account_type_id, parent_account_id]
            );
            inserted++;
            if (inserted % 50 === 0) console.log(`   Processed ${inserted + updated} accounts...`);
          }
        }
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          if (updateExisting) {
            await db.query(
              `UPDATE chart_of_accounts 
               SET name = ?, is_active = ?, category = ?, type = ?, account_type_id = ?, 
                   parent_account_id = ?, updated_at = NOW()
               WHERE account_code = ?`,
              [description, is_active, category, type, account_type_id, parent_account_id, account_code]
            );
            updated++;
          } else {
            skipped++;
          }
        } else {
          errors.push(`Account ${account_code}: ${err.message}`);
          console.error(`❌ Error inserting ${account_code}:`, err.message);
        }
      }
    }
    
    console.log('\n================================================');
    console.log('📊 Import Summary:');
    console.log(`   ✅ Inserted: ${inserted}`);
    console.log(`   🔄 Updated: ${updated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    if (errors.length > 0) {
      console.log(`   ❌ Errors: ${errors.length}`);
      if (errors.length <= 10) {
        console.log('\nErrors:');
        errors.forEach(err => console.log(`   - ${err}`));
      } else {
        console.log(`\nFirst 10 errors:`);
        errors.slice(0, 10).forEach(err => console.log(`   - ${err}`));
        console.log(`   ... and ${errors.length - 10} more errors`);
      }
    }
    console.log('================================================\n');
    
    return {
      success: true,
      inserted,
      updated,
      skipped,
      errors
    };
  } catch (err) {
    console.error('❌ Error importing chart of accounts:', err);
    throw err;
  }
}

// Run if called directly
if (require.main === module) {
  // Handle file path with spaces - combine all args until we hit an option flag
  let csvPath = '';
  const optionFlags = ['--delete-existing', '--no-update', '--dry-run'];
  
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (optionFlags.includes(arg)) {
      break;
    }
    if (csvPath) {
      csvPath += ' ' + arg;
    } else {
      csvPath = arg;
    }
  }
  
  // Remove quotes if present
  csvPath = csvPath.replace(/^["']|["']$/g, '');
  
  if (!csvPath) {
    console.error('❌ Usage: node scripts/importChartOfAccountsNewFormat.js <path-to-csv-file> [--delete-existing] [--no-update] [--dry-run]');
    console.error('');
    console.error('Options:');
    console.error('  --delete-existing  Delete all existing accounts before import');
    console.error('  --no-update        Skip updating existing accounts');
    console.error('  --dry-run          Show what would be imported without actually importing');
    console.error('');
    console.error('Example:');
    console.error('  node scripts/importChartOfAccountsNewFormat.js "C:\\path\\to\\file with spaces.csv" --delete-existing');
    process.exit(1);
  }
  
  const options = {
    deleteExisting: process.argv.includes('--delete-existing'),
    updateExisting: !process.argv.includes('--no-update'),
    dryRun: process.argv.includes('--dry-run')
  };
  
  importChartOfAccountsNewFormat(csvPath, options)
    .then(() => {
      console.log('✅ Import completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Import failed:', error);
      process.exit(1);
    });
}

module.exports = importChartOfAccountsNewFormat;
