-- Add CDS Account and Custodian Bank columns to joint_counterparty_relationships table
ALTER TABLE joint_counterparty_relationships 
ADD COLUMN IF NOT EXISTS cds_account VARCHAR(255) AFTER mobile,
ADD COLUMN IF NOT EXISTS custodian_bank VARCHAR(255) AFTER cds_account;

