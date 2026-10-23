#!/usr/bin/env bash
# Verifies the REAL background path: API (CELERY_ENABLED=true) → outbox → Celery worker over Redis → jobs → mock adapter.
# Uses the isolated QA database. Prints a JSON verdict.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; LOG=/tmp/qa-logs; mkdir -p "$LOG"
export DATABASE_URL="${QA_DATABASE_URL:-postgres://expo:expo@127.0.0.1:5432/expo_leads_qa}" CELERY_ENABLED=true CELERY_BROKER_URL=redis://127.0.0.1:6379/5 LOGIN_THROTTLE=500/min
redis-server --port 6379 --daemonize yes >/dev/null
cd "$ROOT/backend"
nohup ../.venv/bin/python manage.py runserver 127.0.0.1:8002 --noreload >"$LOG/celery-api.log" 2>&1 & API=$!
nohup ../.venv/bin/celery -A config worker -l info -c 2 >"$LOG/celery-worker.log" 2>&1 & W=$!
sleep 6
../.venv/bin/python - <<'PY'
import json, time, urllib.request, uuid
from http.cookiejar import CookieJar
B="http://127.0.0.1:8002"
def sess(u):
    j=CookieJar(); op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(j)); op.open(B+"/api/v1/auth/csrf").read()
    t=next(c.value for c in j if c.name=="csrftoken")
    op.open(urllib.request.Request(B+"/api/v1/auth/login",data=json.dumps({"username":u,"password":"Demo@Expo1405"}).encode(),headers={"Content-Type":"application/json","X-CSRFToken":t,"Referer":B})).read()
    return op, next(c.value for c in j if c.name=="csrftoken")
def call(s,m,p,b=None):
    r=s[0].open(urllib.request.Request(B+"/api/v1"+p,data=json.dumps(b).encode() if b is not None else None,method=m,headers={"Content-Type":"application/json","X-CSRFToken":s[1],"Referer":B}))
    return json.loads(r.read() or b"null")
mdm=sess("mdm"); pm=sess("planmgr")
tech=[e for e in call(mdm,"GET","/events/mine") if e["code"]=="DEMO-TECH-1405"][0]
lead=call(mdm,"POST","/interactions",{"event_id":tech["id"],"client_record_id":str(uuid.uuid4()),"contact_name":"سلری "+uuid.uuid4().hex[:5],"mobile":"09120004444","product_ids":[tech["products"][0]["id"]]})
me=call(pm,"GET","/auth/me")
call(mdm,"POST",f"/interactions/{lead['id']}/refer",{"to_user_id":me["user"]["id"]})
time.sleep(12)
import os, django, sys
sys.path.insert(0,"."); os.environ.setdefault("DJANGO_SETTINGS_MODULE","config.settings"); django.setup()
from apps.common.models import OutboxEvent
from apps.notify.models import NotificationJob, Notification
ev=OutboxEvent.objects.filter(aggregate_id__in=[r.aggregate_id for r in OutboxEvent.objects.filter(payload__interaction_id=lead["id"])])
jobs=NotificationJob.objects.filter(context__interaction_id=lead["id"])
from apps.notify.engine import process_outbox
process_outbox()  # re-run: must not create duplicate jobs (at-least-once + dedup key)
jobs2=NotificationJob.objects.filter(context__interaction_id=lead["id"])
print(json.dumps({
 "outbox_statuses": sorted({e.status for e in OutboxEvent.objects.filter(payload__interaction_id=lead["id"])}),
 "jobs": sorted([(j.channel, j.status) for j in jobs]),
 "jobs_after_rerun": jobs2.count(), "jobs_before_rerun": jobs.count(),
 "in_app_notifications_for_recipient": Notification.objects.filter(recipient__username="planmgr", body__contains=tech["code"]).count() > 0,
 "worker_log_mentions_task": "process_outbox_task" in open("/tmp/qa-logs/celery-worker.log").read(),
}, ensure_ascii=False))
PY
kill $API $W 2>/dev/null; redis-cli -p 6379 shutdown nosave >/dev/null 2>&1 || true
