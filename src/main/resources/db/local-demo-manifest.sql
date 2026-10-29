-- Additive identity tracking only. Run explicitly in the authorized local lagermanager schema.
-- Never drops, truncates or updates existing business tables.
CREATE TABLE IF NOT EXISTS demo_seed_record (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    record_id BIGINT NOT NULL,
    created_by_seed BIT(1) NOT NULL
) ENGINE=InnoDB;
