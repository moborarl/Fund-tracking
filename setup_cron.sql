-- เปิด extension ที่จำเป็น
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- (ทดสอบ) ยิงเรียกฟังก์ชันทันที 1 ครั้ง — รอ 10-20 วิ แล้วไปดู Table Editor > nav_history
select net.http_post(
  url := 'https://pmfqjnheavnbqpsdnffm.supabase.co/functions/v1/nav-refresh',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'Authorization','Bearer sb_publishable_LIvzmoSxnvSXN8MaTkESNw_Bcj0pQim',
    'apikey','sb_publishable_LIvzmoSxnvSXN8MaTkESNw_Bcj0pQim'
  )
);

-- ตั้งให้รันอัตโนมัติทุกวัน 13:00 UTC (= 20:00 ไทย)
select cron.schedule(
  'nav-daily',
  '0 13 * * *',
  $$
  select net.http_post(
    url := 'https://pmfqjnheavnbqpsdnffm.supabase.co/functions/v1/nav-refresh',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer sb_publishable_LIvzmoSxnvSXN8MaTkESNw_Bcj0pQim',
      'apikey','sb_publishable_LIvzmoSxnvSXN8MaTkESNw_Bcj0pQim'
    )
  );
  $$
);

-- ดูรายการ job ที่ตั้งไว้
select jobid, schedule, jobname from cron.job;
