ALTER TABLE `holiday_calendar` 
ADD COLUMN `fund_centre_id` INT NULL AFTER `reason`;

CREATE INDEX `idx_fund_centre_id` ON `holiday_calendar` (`fund_centre_id`);

ALTER TABLE `holiday_calendar` 
ADD CONSTRAINT `fk_holiday_calendar_fund_centre` 
FOREIGN KEY (`fund_centre_id`) 
REFERENCES `fund_centre_master` (`id`) 
ON DELETE SET NULL 
ON UPDATE CASCADE;
