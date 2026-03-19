-- Add 3-tier authorization fields to repo_deals (nullable/default-safe)
ALTER TABLE repo_deals
  ADD COLUMN approval_status VARCHAR(32) NULL AFTER status,
  ADD COLUMN current_approval_level VARCHAR(32) NULL AFTER approval_status,
  ADD COLUMN comment TEXT NULL AFTER current_approval_level,
  ADD COLUMN authorized_by INT NULL AFTER comment,
  ADD COLUMN authorized_at DATETIME NULL AFTER authorized_by;

