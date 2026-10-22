-- Rename Casual Leave -> Planned Leave; add Tentative Leave (leave_type = 'tentative', status = 'tentative').
UPDATE public.leaves SET leave_type = 'planned' WHERE leave_type = 'casual';
ALTER TABLE public.leaves ALTER COLUMN leave_type SET DEFAULT 'planned';
-- status values: 'pending', 'tentative', 'approved', 'rejected', 'cancelled'
