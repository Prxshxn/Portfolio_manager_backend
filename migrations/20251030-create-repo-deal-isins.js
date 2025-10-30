const db = require('../config/db');

module.exports = async function createRepoDealIsinsTable() {
  // Create child table to support multiple ISINs per repo deal and backfill existing data
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS repo_deal_isins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      repo_deal_id INT NOT NULL,
      isin_number VARCHAR(32) NOT NULL,
      face_value DECIMAL(18,6) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_repo_deal_isins_repo_deal
        FOREIGN KEY (repo_deal_id) REFERENCES repo_deals(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const addIndexSql = `
    CREATE INDEX IF NOT EXISTS idx_repo_deal_isins_repo_deal_id ON repo_deal_isins(repo_deal_id);
  `;

  const addIsinIndexSql = `
    CREATE INDEX IF NOT EXISTS idx_repo_deal_isins_isin_number ON repo_deal_isins(isin_number);
  `;

  // Backfill: copy existing single ISIN from repo_deals into child table if not already copied
  const backfillSql = `
    INSERT INTO repo_deal_isins (repo_deal_id, isin_number, face_value)
    SELECT rd.id, rd.isin_number, rd.face_value
    FROM repo_deals rd
    LEFT JOIN repo_deal_isins rdi
      ON rdi.repo_deal_id = rd.id
    WHERE rd.isin_number IS NOT NULL
      AND rd.isin_number <> ''
      AND rdi.id IS NULL;
  `;

  await db.query(createTableSql);
  try {
    await db.query(addIndexSql);
  } catch (e) {
    // Some MySQL versions don't support IF NOT EXISTS on CREATE INDEX, ignore if exists
  }
  try {
    await db.query(addIsinIndexSql);
  } catch (e) {
    // Ignore if index already exists
  }
  await db.query(backfillSql);
};


