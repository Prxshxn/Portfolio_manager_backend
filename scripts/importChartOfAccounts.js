const fs = require('fs');
const path = require('path');
const db = require('../config/database');

/**
 * Import Chart of Accounts from CSV file
 * 
 * Usage:
 *   node scripts/importChartOfAccounts.js <path-to-csv-file>
 * 
 * CSV Format Expected:
 *   Account Code,Description,Active Status
 *   1-001-01-01-01,Asset Motor Vehicles,Yes
 *   1-002-01-01-01,Asset Office Computers,Yes
 * 
 * Or with section headers:
 *   ASSET
 *   Account Code,Description,Active Status
 *   1-001-01-01-01,Asset Motor Vehicles,Yes
 */

function inferCategory(section) {
  if (!section) return 'BS';
  const upperSection = section.toUpperCase();
  if (/ASSET|LIABILITY|RETAINED PROFIT|EQUITY/i.test(upperSection)) return 'BS';
  if (/EXPENSE|INCOME|TAX|REVENUE/i.test(upperSection)) return 'PL';
  return 'BS';
}

function inferAccountType(name, section) {
  // Try to infer account type from name or section
  const upperName = (name || '').toUpperCase();
  const upperSection = (section || '').toUpperCase();
  
  // Common patterns
  if (/CASH|BANK|CURRENT ACCOUNT|SAVINGS/i.test(upperName)) return 'Cash and Cash Equivalents';
  if (/INVESTMENT|BOND|SECURITY|GSEC|TREASURY/i.test(upperName)) return 'Investments';
  if (/RECEIVABLE|DEBTOR/i.test(upperName)) return 'Accounts Receivable';
  if (/PAYABLE|CREDITOR/i.test(upperName)) return 'Accounts Payable';
  if (/LOAN|BORROWING|LIABILITY/i.test(upperName)) return 'Loans Payable';
  if (/INTEREST.*INCOME|INCOME.*INTEREST/i.test(upperName)) return 'Interest Income';
  if (/INTEREST.*EXPENSE|EXPENSE.*INTEREST/i.test(upperName)) return 'Interest Expenses';
  if (/FEE|COMMISSION/i.test(upperName)) return 'Fee Income';
  if (/EXPENSE|COST/i.test(upperName)) return 'Operating Expenses';
  
  // Default based on section
  if (/ASSET/i.test(upperSection)) return 'Other Assets';
  if (/LIABILITY/i.test(upperSection)) return 'Other Liabilities';
  if (/INCOME|REVENUE/i.test(upperSection)) return 'Other Income';
  if (/EXPENSE/i.test(upperSection)) return 'Other Expenses';
  
  return 'Other Assets'; // Default fallback
}

async function importChartOfAccounts(csvPath, options = {}) {
  const {
    deleteExisting = false,
    updateExisting = true,
    dryRun = false
  } = options;

  try {
    console.log('📋 Chart of Accounts Import Script');
    console.log('=====================================');
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
      await db.query('DELETE FROM chart_of_accounts');
      console.log('✅ Deleted all existing accounts.');
    }

    // 2. Read and parse CSV
    const raw = fs.readFileSync(csvPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    
    let section = '';
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = [];
    let headerFound = false;

    // Get all account types for lookup
    const [accountTypes] = await db.query('SELECT id, name FROM account_types');
    const accountTypeMap = {};
    accountTypes.forEach(at => {
      accountTypeMap[at.name.toLowerCase()] = at.id;
    });

    console.log('📊 Processing CSV lines...\n');

    for (let i = 0; i < lines.length; ++i) {
      const line = lines[i].trim();
      
      // Skip empty lines
      if (!line) continue;
      
      // Skip lines that are just commas
      if (line.replace(/,/g, '').trim() === '') continue;
      
      // Detect header row
      if (/Account Code|Account Number|account_code/i.test(line) && /Description|description/i.test(line)) {
        headerFound = true;
        continue;
      }
      
      // Section header detection
      const sectionMatch = line.match(/^(ASSET|LIABILITY|EXPENSE|INCOME|REVENUE|TAX|RETAINED PROFIT|EQUITY|CURRENT ASSET|NON CURRENT)/i);
      if (sectionMatch && !line.includes(',')) {
        section = line.replace(/,/g, '').trim();
        console.log(`📂 Section: ${section}`);
        continue;
      }
      
      // Skip if header not found yet
      if (!headerFound) continue;
      
      // Parse data row
      const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      
      if (parts.length < 2) continue;
      
      const account_code = parts[0].trim();
      const name = parts[1].trim();
      const active = parts[2] ? parts[2].trim() : 'Yes';
      
      // Skip if account_code is empty or doesn't look like an account code
      if (!account_code || account_code === '' || account_code === 'Account Code') continue;
      
      // Validate account code format (should contain numbers or dashes)
      if (!/[\d-]/.test(account_code)) {
        skipped++;
        continue;
      }
      
      const is_active = /yes|true|1|active/i.test(active);
      const category = inferCategory(section);
      const type = 'GL';
      
      // Find account_type_id
      const typeName = inferAccountType(name, section);
      let account_type_id = accountTypeMap[typeName.toLowerCase()];
      
      // If not found, try to find by partial match
      if (!account_type_id) {
        for (const [typeNameKey, typeId] of Object.entries(accountTypeMap)) {
          if (typeName.toLowerCase().includes(typeNameKey) || typeNameKey.includes(typeName.toLowerCase())) {
            account_type_id = typeId;
            break;
          }
        }
      }
      
      // If still not found, use first available account type as fallback
      if (!account_type_id && accountTypes.length > 0) {
        account_type_id = accountTypes[0].id;
        console.warn(`⚠️  Account ${account_code}: Using fallback account_type_id ${account_type_id} (${accountTypes[0].name})`);
      }
      
      if (!account_type_id) {
        errors.push(`Account ${account_code} (${name}): No account_type_id found`);
        skipped++;
        continue;
      }
      
      try {
        if (dryRun) {
          console.log(`[DRY RUN] Would ${updateExisting ? 'insert/update' : 'insert'}: ${account_code} - ${name}`);
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
                 SET name = ?, is_active = ?, category = ?, type = ?, account_type_id = ?, updated_at = NOW()
                 WHERE account_code = ?`,
                [name, is_active, category, type, account_type_id, account_code]
              );
              updated++;
              console.log(`🔄 Updated: ${account_code} - ${name}`);
            } else {
              skipped++;
              console.log(`⏭️  Skipped (exists): ${account_code} - ${name}`);
            }
          } else {
            await db.query(
              `INSERT INTO chart_of_accounts 
               (account_code, name, is_active, category, type, account_type_id, created_at, updated_at) 
               VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
              [account_code, name, is_active, category, type, account_type_id]
            );
            inserted++;
            console.log(`✅ Inserted: ${account_code} - ${name}`);
          }
        }
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          if (updateExisting) {
            await db.query(
              `UPDATE chart_of_accounts 
               SET name = ?, is_active = ?, category = ?, type = ?, account_type_id = ?, updated_at = NOW()
               WHERE account_code = ?`,
              [name, is_active, category, type, account_type_id, account_code]
            );
            updated++;
            console.log(`🔄 Updated (duplicate): ${account_code} - ${name}`);
          } else {
            skipped++;
            console.log(`⏭️  Skipped (duplicate): ${account_code} - ${name}`);
          }
        } else {
          errors.push(`Account ${account_code}: ${err.message}`);
          console.error(`❌ Error inserting ${account_code}:`, err.message);
        }
      }
    }
    
    console.log('\n=====================================');
    console.log('📊 Import Summary:');
    console.log(`   ✅ Inserted: ${inserted}`);
    console.log(`   🔄 Updated: ${updated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    if (errors.length > 0) {
      console.log(`   ❌ Errors: ${errors.length}`);
      console.log('\nErrors:');
      errors.forEach(err => console.log(`   - ${err}`));
    }
    console.log('=====================================\n');
    
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
  const csvPath = process.argv[2];
  
  if (!csvPath) {
    console.error('❌ Usage: node scripts/importChartOfAccounts.js <path-to-csv-file> [--delete-existing] [--no-update] [--dry-run]');
    console.error('');
    console.error('Options:');
    console.error('  --delete-existing  Delete all existing accounts before import');
    console.error('  --no-update        Skip updating existing accounts');
    console.error('  --dry-run          Show what would be imported without actually importing');
    process.exit(1);
  }
  
  const options = {
    deleteExisting: process.argv.includes('--delete-existing'),
    updateExisting: !process.argv.includes('--no-update'),
    dryRun: process.argv.includes('--dry-run')
  };
  
  importChartOfAccounts(csvPath, options)
    .then(() => {
      console.log('✅ Import completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Import failed:', error);
      process.exit(1);
    });
}

module.exports = importChartOfAccounts;
