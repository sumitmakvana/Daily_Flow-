ALTER TABLE public.work_settings 
ADD COLUMN IF NOT EXISTS morning_digest_time TEXT DEFAULT '10:00',
ADD COLUMN IF NOT EXISTS evening_digest_time TEXT DEFAULT '18:00';

UPDATE public.work_settings
SET morning_digest_time = '10:00'
WHERE id = 1 AND (morning_digest_time = '11:00' OR morning_digest_time IS NULL);
