#!/usr/bin/env node
'use strict';

/**
 * Correct BB20260623001: remove erroneous .08 from face value only.
 *   1,986,697.08  ->  1,986,697.00
 *
 * Settlement amounts and ledger entries are NOT changed.
 * Restores 0.08 to source buy remaining_face_value.
 *
 * Usage:
 *   node scripts/fix-bb20260623001-face-allocation.js           # dry-run
 *   node scripts/fix-bb20260623001-face-allocation.js --execute  # apply
 */

require('./fix-bb20260623001-face-only.js');
