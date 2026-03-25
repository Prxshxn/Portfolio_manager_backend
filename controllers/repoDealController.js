const RepoDeal = require('../models/repoDealModel');
const holidayValidationService = require('../services/holidayValidationService');

const mapRepoUpdatePayloadToColumns = (payload = {}) => {
  const map = {
    dealType: 'deal_type',
    counterparty: 'counterparty_id',
    settlementMode: 'settlement_mode',
    tradeDate: 'trade_date',
    valueDate: 'value_date',
    maturityDate: 'maturity_date',
    principalAmount: 'principal_amount',
    interestAmount: 'interest_amount',
    rate: 'rate',
    maturityAmount: 'maturity_amount',
    tenor: 'tenor',
    calculationDayBasis: 'calculation_day_basis',
    isin: 'isin_number',
    issueDate: 'issue_date',
    haircut: 'haircut',
    faceValue: 'face_value',
    faceValueAdjustment: 'face_value_adjustment',
    faceValueAsPerCounterparty: 'face_value_as_per_counterparty',
    status: 'status',
    approvalStatus: 'approval_status',
    currentApprovalLevel: 'current_approval_level',
    comment: 'comment'
  };

  const normalized = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    const mappedKey = map[key] || key;
    normalized[mappedKey] = value;
  }

  if (normalized.counterparty_id !== undefined && normalized.counterparty_id !== null && normalized.counterparty_id !== '') {
    const parsed = parseInt(normalized.counterparty_id, 10);
    if (Number.isNaN(parsed)) {
      // Avoid overwriting existing counterparty_id with NULL/NaN.
      delete normalized.counterparty_id;
    } else {
      normalized.counterparty_id = parsed;
    }
  }
  if (normalized.principal_amount !== undefined) normalized.principal_amount = parseFloat(normalized.principal_amount);
  if (normalized.interest_amount !== undefined) normalized.interest_amount = parseFloat(normalized.interest_amount);
  if (normalized.rate !== undefined) normalized.rate = parseFloat(normalized.rate);
  if (normalized.maturity_amount !== undefined) normalized.maturity_amount = parseFloat(normalized.maturity_amount);
  if (normalized.tenor !== undefined) normalized.tenor = parseInt(normalized.tenor, 10);
  if (normalized.calculation_day_basis !== undefined) normalized.calculation_day_basis = parseInt(normalized.calculation_day_basis, 10);
  if (normalized.haircut !== undefined) normalized.haircut = parseFloat(normalized.haircut);
  if (normalized.face_value !== undefined) normalized.face_value = parseFloat(normalized.face_value);
  if (normalized.face_value_adjustment !== undefined) normalized.face_value_adjustment = parseFloat(normalized.face_value_adjustment);
  if (normalized.face_value_as_per_counterparty !== undefined) normalized.face_value_as_per_counterparty = parseFloat(normalized.face_value_as_per_counterparty);

  return normalized;
};

const repoDealController = {
  // Create a new repo deal
  create: async (req, res) => {
    try {
      console.log('📥 Repo deal creation request body:', JSON.stringify(req.body, null, 2));
      
      const {
         dealType,
         counterparty,
        settlementMode,
         tradeDate,
        valueDate,
        maturityDate,
        principalAmount,
        interestAmount,
        rate,
        maturityAmount,
        tenor,
        calculationDayBasis,
        isin,
        isins,
        issueDate,
        haircut,
        faceValue,
        faceValueAdjustment,
        faceValueAsPerCounterparty
      } = req.body;

      const counterpartyId = (() => {
        // UI should send counterparty as numeric id (or numeric string). Guard against names/objects.
        if (counterparty === undefined || counterparty === null || counterparty === '') return null;
        const parsed = parseInt(counterparty, 10);
        return Number.isNaN(parsed) ? null : parsed;
      })();

             // Validation
      const hasIsinsArray = Array.isArray(isins) && isins.length > 0;
      const hasIsin = isin && typeof isin === 'string' && isin.trim() !== '';
      
      console.log('🔍 Validation check:', {
        hasIsin,
        hasIsinsArray,
        isin: isin || '(empty)',
        isins: isins || '(not provided)',
        dealType: dealType || '(missing)',
        counterparty: counterparty || '(missing)',
        counterpartyId,
        tradeDate: tradeDate || '(missing)',
        valueDate: valueDate || '(missing)',
        maturityDate: maturityDate || '(missing)',
        principalAmount: principalAmount || '(missing)',
        rate: rate || '(missing)',
        tenor: tenor || '(missing)',
        calculationDayBasis: calculationDayBasis || '(missing)'
      });
      
      // Check numeric fields - they can be 0 but not undefined/null
      const hasPrincipalAmount = principalAmount !== undefined && principalAmount !== null && principalAmount !== '';
      const hasRate = rate !== undefined && rate !== null && rate !== '';
      const hasTenor = tenor !== undefined && tenor !== null && tenor !== '';
      
      if (!dealType || !counterpartyId || !tradeDate || !valueDate || !maturityDate || 
          !hasPrincipalAmount || !hasRate || !hasTenor || !calculationDayBasis || (!hasIsin && !hasIsinsArray)) {
         const missingFields = [];
         if (!dealType) missingFields.push('dealType');
         if (!counterpartyId) missingFields.push('counterparty');
         if (!tradeDate) missingFields.push('tradeDate');
         if (!valueDate) missingFields.push('valueDate');
         if (!maturityDate) missingFields.push('maturityDate');
         if (!hasPrincipalAmount) missingFields.push('principalAmount');
         if (!hasRate) missingFields.push('rate');
         if (!hasTenor) missingFields.push('tenor');
         if (!calculationDayBasis) missingFields.push('calculationDayBasis');
         if (!hasIsin && !hasIsinsArray) missingFields.push('isin or isins array');
         
         console.error('❌ Validation failed. Missing fields:', missingFields);
         return res.status(400).json({
           success: false,
          message: `Missing required fields: ${missingFields.join(', ')}. Please provide either a single ISIN or select multiple ISINs.`
         });
       }
       
       // If using multiple ISINs but no primary ISIN, use first ISIN from array as primary
       const primaryIsin = hasIsin ? isin : (hasIsinsArray ? isins[0].isin : null);

      // Validate deal type
      if (!['Repo', 'Reverse Repo'].includes(dealType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid deal type. Must be "Repo" or "Reverse Repo"'
        });
      }

      

      // Validate dates
      const trade = new Date(tradeDate);
      const value = new Date(valueDate);
      const maturity = new Date(maturityDate);
      
      if (value < trade) {
        return res.status(400).json({
          success: false,
          message: 'Value date cannot be before trade date'
        });
      }
      
      if (maturity <= value) {
        return res.status(400).json({
          success: false,
          message: 'Maturity date must be after value date'
        });
      }

      // Validate amounts
      if (principalAmount <= 0 || rate <= 0 || tenor <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Principal amount, rate, and tenor must be positive values'
        });
      }

      // Validate day basis
      if (![364, 365].includes(parseInt(calculationDayBasis))) {
        return res.status(400).json({
          success: false,
          message: 'Calculation day basis must be 364 or 365'
        });
      }

      // Holiday validation - check if transaction dates are holidays
      // Default currency is LKR for repo deals
      const currency = 'LKR';
      const holidayValidation = await holidayValidationService.validateTransactionDates({
        tradeDate: tradeDate,
        valueDate: valueDate,
        currency: currency
      });

      if (holidayValidation.isHoliday) {
        return res.status(400).json({
          success: false,
          message: holidayValidation.message
        });
      }

             // Create deal data object
      const dealData = {
         dealType,
         counterparty: counterpartyId,
         tradeDate,
        valueDate,
        maturityDate,
        principalAmount: parseFloat(principalAmount),
        interestAmount: parseFloat(interestAmount) || 0,
        rate: parseFloat(rate),
        maturityAmount: parseFloat(maturityAmount) || 0,
        tenor: parseInt(tenor),
        calculationDayBasis: parseInt(calculationDayBasis),
        isin: primaryIsin, // Use primary ISIN (either provided or first from array)
        isins: hasIsinsArray ? isins : undefined,
        issueDate,
        settlementMode,
        haircut: parseFloat(haircut) || 0,
        faceValue: parseFloat(faceValue) || null,
        faceValueAdjustment: parseFloat(faceValueAdjustment) || 0,
        faceValueAsPerCounterparty: parseFloat(faceValueAsPerCounterparty) || null,
        approvalStatus: 'pending',
        currentApprovalLevel: 'front_office',
        createdBy: req.user?.id || 1 // From auth middleware, fallback to user ID 1
      };

      // Create the repo deal
      const newDeal = await RepoDeal.create(dealData);

      res.status(201).json({
        success: true,
        message: 'Repo deal created successfully',
        data: newDeal
      });

    } catch (error) {
      console.error('Error creating repo deal:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get all repo deals with optional filters
  getAll: async (req, res) => {
    try {
      const filters = {
        dealType: req.query.dealType,
        status: req.query.status,
        counterpartyId: req.query.counterpartyId,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      };

      const deals = await RepoDeal.getAll(filters);

      res.json({
        success: true,
        message: 'Repo deals retrieved successfully',
        data: deals
      });

    } catch (error) {
      console.error('Error fetching repo deals:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get repo deal by ID
  getById: async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: 'Valid ID is required'
        });
      }

      const deal = await RepoDeal.getById(parseInt(id));
      
      if (!deal) {
        return res.status(404).json({
          success: false,
          message: 'Repo deal not found'
        });
      }

      res.json({
        success: true,
        message: 'Repo deal retrieved successfully',
        data: deal
      });

    } catch (error) {
      console.error('Error fetching repo deal:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Update repo deal
  update: async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: 'Valid ID is required'
        });
      }

      // Check if deal exists
      const existingDeal = await RepoDeal.getById(parseInt(id));
      if (!existingDeal) {
        return res.status(404).json({
          success: false,
          message: 'Repo deal not found'
        });
      }

      // Only allow updates if deal is not matured or cancelled
      if (['Matured', 'Cancelled'].includes(existingDeal.status)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot update matured or cancelled deals'
        });
      }

      const existingApprovalStatus = String(existingDeal.approval_status || '').toLowerCase();
      const existingApprovalLevel = String(existingDeal.current_approval_level || '').toLowerCase();
      const isRejected = existingApprovalStatus === 'rejected' || existingApprovalLevel === 'rejected';
      if (!isRejected) {
        return res.status(400).json({
          success: false,
          message: 'Only rejected repo deals can be edited'
        });
      }

      const updateData = mapRepoUpdatePayloadToColumns(req.body);
      
      // Remove fields that shouldn't be updated
      delete updateData.id;
      delete updateData.created_by;
      delete updateData.created_at;
      delete updateData.updated_at;

      // Validate dates if provided
      if (updateData.value_date && updateData.trade_date) {
        const value = new Date(updateData.value_date);
        const trade = new Date(updateData.trade_date);
        if (value < trade) {
          return res.status(400).json({
            success: false,
            message: 'Value date cannot be before trade date'
          });
        }
      }

      if (updateData.maturity_date && updateData.value_date) {
        const maturity = new Date(updateData.maturity_date);
        const value = new Date(updateData.value_date);
        if (maturity <= value) {
          return res.status(400).json({
            success: false,
            message: 'Maturity date must be after value date'
          });
        }
      }

      // Holiday validation - check if updated transaction dates are holidays
      // Default currency is LKR for repo deals
      const currency = 'LKR';
      const holidayValidation = await holidayValidationService.validateTransactionDates({
        tradeDate: updateData.trade_date || existingDeal.trade_date,
        valueDate: updateData.value_date || existingDeal.value_date,
        currency: currency
      });

      if (holidayValidation.isHoliday) {
        return res.status(400).json({
          success: false,
          message: holidayValidation.message
        });
      }

      // Re-submit edited rejected deals into approval flow.
      updateData.approval_status = 'pending';
      updateData.current_approval_level = 'front_office';

      // Update the deal
      const updatedDeal = await RepoDeal.update(parseInt(id), updateData);

      res.json({
        success: true,
        message: 'Rejected repo deal updated and re-submitted successfully',
        data: updatedDeal
      });

    } catch (error) {
      console.error('Error updating repo deal:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Delete repo deal
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: 'Valid ID is required'
        });
      }

      // Check if deal exists
      const existingDeal = await RepoDeal.getById(parseInt(id));
      if (!existingDeal) {
        return res.status(404).json({
          success: false,
          message: 'Repo deal not found'
        });
      }

      // Only allow deletion if deal is pending
      if (existingDeal.status !== 'Pending') {
        return res.status(400).json({
          success: false,
          message: 'Can only delete pending deals'
        });
      }

      await RepoDeal.delete(parseInt(id));

      res.json({
        success: true,
        message: 'Repo deal deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting repo deal:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Update deal status
  updateStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: 'Valid ID is required'
        });
      }

      if (!status || !['Pending', 'Active', 'Matured', 'Cancelled'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Valid status is required (Pending, Active, Matured, Cancelled)'
        });
      }

      // Check if deal exists
      const existingDeal = await RepoDeal.getById(parseInt(id));
      if (!existingDeal) {
        return res.status(404).json({
          success: false,
          message: 'Repo deal not found'
        });
      }

      // Update the status
      const updatedDeal = await RepoDeal.updateStatus(parseInt(id), status);

      res.json({
        success: true,
        message: 'Repo deal status updated successfully',
        data: updatedDeal
      });

    } catch (error) {
      console.error('Error updating repo deal status:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // 3-tier authorization (separate from repo lifecycle status)
  updateApprovalStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { action, comment } = req.body;

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ success: false, message: 'Valid ID is required' });
      }

      if (!action || !['approved', 'rejected'].includes(action)) {
        return res.status(400).json({ success: false, message: 'Valid action is required (approved, rejected)' });
      }

      const user = req.user;
      if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const allowedTabs = user.allowed_tabs || user.allowedTabs || [];
      if (!Array.isArray(allowedTabs) || !allowedTabs.includes('repo')) {
        return res.status(403).json({ success: false, message: 'Access denied: repo not assigned' });
      }

      const existingDeal = await RepoDeal.getById(parseInt(id));
      if (!existingDeal) {
        return res.status(404).json({ success: false, message: 'Repo deal not found' });
      }

      const currentLevel = existingDeal.current_approval_level || 'front_office';

      const role = user.role;
      const isAdmin = role === 'admin' || user.isAdmin;
      const requiredRoleByLevel = {
        front_office: 'front_office',
        back_office_verifier: 'back_office_verifier',
        back_office_final: 'back_office_final'
      };
      const requiredRole = requiredRoleByLevel[currentLevel];

      if (!isAdmin && requiredRole && role !== requiredRole) {
        return res.status(403).json({
          success: false,
          message: `Access denied: ${requiredRole} required for ${currentLevel}`
        });
      }

      // Only allow workflow changes when still in workflow (pending)
      const approvalStatus = existingDeal.approval_status || 'pending';
      if (approvalStatus !== 'pending' && currentLevel !== 'rejected') {
        return res.status(400).json({
          success: false,
          message: `Deal is not pending authorization (approval_status=${approvalStatus})`
        });
      }

      await RepoDeal.updateApprovalStatus(parseInt(id), {
        action,
        comment,
        userId: user.id
      });

      const updatedDeal = await RepoDeal.getById(parseInt(id));
      return res.json({
        success: true,
        message: 'Repo approval updated successfully',
        data: updatedDeal
      });
    } catch (error) {
      console.error('Error updating repo approval:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get repo deals by counterparty
  getByCounterparty: async (req, res) => {
    try {
      const { counterpartyId } = req.params;
      
      if (!counterpartyId || isNaN(parseInt(counterpartyId))) {
        return res.status(400).json({
          success: false,
          message: 'Valid counterparty ID is required'
        });
      }

      const deals = await RepoDeal.getByCounterparty(parseInt(counterpartyId));

      res.json({
        success: true,
        message: 'Repo deals retrieved successfully',
        data: deals
      });

    } catch (error) {
      console.error('Error fetching repo deals by counterparty:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get repo deals by ISIN
  getByIsin: async (req, res) => {
    try {
      const { isinNumber } = req.params;
      
      if (!isinNumber) {
        return res.status(400).json({
          success: false,
          message: 'ISIN number is required'
        });
      }

      const deals = await RepoDeal.getByIsin(isinNumber);

      res.json({
        success: true,
        message: 'Repo deals retrieved successfully',
        data: deals
      });

    } catch (error) {
      console.error('Error fetching repo deals by ISIN:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get active repo deals
  getActive: async (req, res) => {
    try {
      const deals = await RepoDeal.getActive();

      res.json({
        success: true,
        message: 'Active repo deals retrieved successfully',
        data: deals
      });

    } catch (error) {
      console.error('Error fetching active repo deals:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get expiring repo deals
  getExpiringSoon: async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 7;
      
      if (days < 1 || days > 365) {
        return res.status(400).json({
          success: false,
          message: 'Days must be between 1 and 365'
        });
      }

      const deals = await RepoDeal.getExpiringSoon(days);

      res.json({
        success: true,
        message: `Repo deals expiring within ${days} days retrieved successfully`,
        data: deals
      });

    } catch (error) {
      console.error('Error fetching expiring repo deals:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get summary statistics
  getSummary: async (req, res) => {
    try {
      const summary = await RepoDeal.getSummary();

      res.json({
        success: true,
        message: 'Repo deals summary retrieved successfully',
        data: summary
      });

    } catch (error) {
      console.error('Error fetching repo deals summary:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
};

module.exports = repoDealController;
