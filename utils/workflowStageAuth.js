'use strict';

// Shared 3-tier approval-stage role map, used by every product's status/approval
// endpoint (GSEC, T-Bill, Money Market, Buyback, Repo) so "who can act on a deal
// at its current stage" is defined once instead of copy-pasted per controller.
// Keys match the `current_approval_level` values used by GSEC/T-Bill/Money Market.
const STAGE_OWNER_ROLES = {
  front_office: ['front_office', 'front_office_verifier'],
  back_office_verifier: ['back_office_verifier'],
  back_office_final: ['back_office_final']
};

function requiredRolesForStage(stageKey) {
  return STAGE_OWNER_ROLES[stageKey] || STAGE_OWNER_ROLES.front_office;
}

function actorCanActAtStage(actor, stageKey) {
  if (!actor) return false;
  if (actor.isAdmin) return true;
  return requiredRolesForStage(stageKey).includes(actor.role);
}

module.exports = { STAGE_OWNER_ROLES, requiredRolesForStage, actorCanActAtStage };
