"""Mocked Supabase backend for exercising the built portal in Playwright.

Matches the REST/auth/functions calls the bundle makes (see assets/index-*.js).
"""
import json
import re
from datetime import date, timedelta, datetime, timezone
from urllib.parse import urlparse, parse_qs

SUPA = "https://ejcxewwckgvbgnnzgcan.supabase.co"

TODAY = date.today()


def d(offset):
    return (TODAY + timedelta(days=offset)).isoformat()


SUBJECTS = [
    {"id": "s1", "name": "علم الوراثة الجزيئية", "code": "BIO401", "teacher": "د. سارة يوسف", "color": "#1D64E8", "sort": 1},
    {"id": "s2", "name": "علم المناعة", "code": "BIO402", "teacher": "د. أحمد كريم", "color": "#0EA5C9", "sort": 2},
    {"id": "s3", "name": "الأحياء المجهرية التطبيقية", "code": "BIO403", "teacher": "د. نور الهدى علي", "color": "#7C3AED", "sort": 3},
    {"id": "s4", "name": "الكيمياء الحياتية السريرية", "code": "BIO404", "teacher": "د. حسين جاسم", "color": "#DB2777", "sort": 4},
    {"id": "s5", "name": "علم البيئة", "code": "BIO405", "teacher": "د. زينب حميد", "color": "#1F8A6B", "sort": 5},
]

SCHEDULE = []
_slots = [("08:30:00", "10:00:00"), ("10:15:00", "11:45:00"), ("12:00:00", "13:30:00")]
for day in range(0, 7):
    for i, (st, en) in enumerate(_slots):
        s = SUBJECTS[(day + i) % len(SUBJECTS)]
        SCHEDULE.append({
            "id": f"sc{day}{i}", "subject_id": s["id"], "day": day, "start_time": st, "end_time": en,
            "type": "عملي" if i == 2 else "نظري", "room": f"قاعة {101 + i}", "note": "" if i else "إحضار الدفتر",
        })

NOW = datetime.now(timezone.utc)
ANNOUNCEMENTS = [
    {"id": "a1", "title": "تأجيل امتحان المناعة الشهري", "body": "تم تأجيل الامتحان إلى الأسبوع القادم بسبب العطلة الرسمية. المادة كما هي.",
     "urgent": True, "pinned": True, "created_by": "u-rep", "created_at": (NOW - timedelta(hours=3)).isoformat(), "updated_at": (NOW - timedelta(hours=3)).isoformat()},
    {"id": "a2", "title": "رفع محاضرات الأسبوع الخامس", "body": "تم رفع ملزمة الوراثة الجزيئية وسلايدات الأحياء المجهرية على قسم المحاضرات.",
     "urgent": False, "pinned": False, "created_by": "u-rep", "created_at": (NOW - timedelta(days=1)).isoformat(), "updated_at": (NOW - timedelta(days=1)).isoformat()},
    {"id": "a3", "title": "جولة ميدانية - علم البيئة", "body": "الجولة الميدانية يوم الخميس الساعة 9 صباحاً من أمام القسم. الحضور إلزامي.",
     "urgent": False, "pinned": False, "created_by": "u-rep", "created_at": (NOW - timedelta(days=4)).isoformat(), "updated_at": (NOW - timedelta(days=4)).isoformat()},
]

EXAMS = [
    {"id": "e1", "subject_id": "s2", "kind": "شهري", "exam_date": d(2), "exam_time": "09:00:00", "room": "قاعة 101", "syllabus": "الفصول 1-3: المناعة الفطرية والمكتسبة"},
    {"id": "e2", "subject_id": "s1", "kind": "يومي", "exam_date": d(0), "exam_time": "10:15:00", "room": "قاعة 102", "syllabus": "تضاعف الـ DNA"},
    {"id": "e3", "subject_id": "s4", "kind": "عملي", "exam_date": d(9), "exam_time": None, "room": "مختبر 3", "syllabus": ""},
    {"id": "e4", "subject_id": "s3", "kind": "فصلي", "exam_date": d(-5), "exam_time": "08:30:00", "room": "قاعة 103", "syllabus": "منتصف الفصل"},
]

MATERIALS = [
    {"id": "m1", "subject_id": "s1", "title": "ملزمة الوراثة الجزيئية - الأسبوع 5", "url": "https://example.com/genetics-w5.pdf", "kind": "ملزمة", "week": 5, "created_at": (NOW - timedelta(days=1)).isoformat()},
    {"id": "m2", "subject_id": "s3", "title": "سلايدات البكتيريا الممرضة", "url": "https://example.com/micro-slides", "kind": "سلايدات", "week": 5, "created_at": (NOW - timedelta(days=2)).isoformat()},
    {"id": "m3", "subject_id": "s2", "title": "أسئلة مراجعة المناعة", "url": "https://example.com/immuno-q", "kind": "أسئلة", "week": 4, "created_at": (NOW - timedelta(days=6)).isoformat()},
    {"id": "m4", "subject_id": "s4", "title": "محاضرة الإنزيمات السريرية", "url": "https://example.com/enzymes", "kind": "محاضرة", "week": None, "created_at": (NOW - timedelta(days=8)).isoformat()},
]

SETTINGS = {"id": 1, "university": "جامعة آشور", "department": "قسم علوم الحياة", "stage": "المرحلة الرابعة", "section": "شعبة أ",
            "rep_name": "علي حسن", "rep_contact": "07700000000", "absence_limit": 6, "updated_at": NOW.isoformat()}

USERS = {
    "bio-std01": {"pin": "482913", "profile": {"id": "u-std", "username": "bio-std01", "email": "student@example.com", "full_name": "مريم عبد الله كاظم",
                                               "student_no": "2021-0456", "role": "student", "status": "active", "created_at": (NOW - timedelta(days=20)).isoformat()}},
    "bio-rep01": {"pin": "735164", "profile": {"id": "u-rep", "username": "bio-rep01", "email": "rep@example.com", "full_name": "علي حسن محمد",
                                               "student_no": "2021-0001", "role": "owner", "status": "active", "created_at": (NOW - timedelta(days=30)).isoformat()}},
}


def _study_item(fmt, n, page):
    """One sample item per study format, in the shape the study-ai function returns."""
    return {
        "summary": {"heading": f"الخلية {n}", "points": [f"**الغشاء البلازمي (Plasma membrane)** يحيط بالخلية {n}.", "يتحكم بدخول وخروج المواد."], "page": page},
        "terms": {"term": f"Organelle {n}", "definition": "تركيب داخل الخلية يؤدي وظيفة محددة.", "page": page},
        "mcq": {"question": f"سؤال {n}: أين يُصنع الـ ATP بشكل رئيسي؟", "options": ["النواة", "الميتوكوندريا (Mitochondria)", "جهاز كولجي", "الرايبوسوم"], "answer": 1,
                "explanation": "الميتوكوندريا هي موقع التنفس الخلوي.", "page": page},
        "true_false": {"statement": f"عبارة {n}: الرايبوسومات تصنع البروتين.", "answer": n % 2 == 1, "correction": "الرايبوسومات موقع تصنيع البروتين.", "page": page},
        "lists": {"question": f"عدّد {n}: مكونات الخلية الحيوانية", "items": ["الغشاء البلازمي", "السايتوبلازم", "النواة"], "page": page},
        "reasons": {"question": f"علّل {n}: تسمى الميتوكوندريا محطة الطاقة", "answer": "لأنها موقع إنتاج الـ ATP.", "page": page},
        "compare": {"title": f"مقارنة {n}", "a": "الخلية النباتية", "b": "الخلية الحيوانية", "rows": [{"aspect": "الجدار الخلوي", "a": "موجود", "b": "غير موجود"}], "page": page},
        "blanks": {"sentence": f"جملة {n}: يحدث البناء الضوئي في _____.", "answer": "البلاستيدات الخضراء", "page": page},
        "essay": {"question": f"سؤال مقالي {n}: اشرح عملية الانقسام", "answer": "يمر الانقسام بعدة مراحل...", "page": page},
    }[fmt]


class MockBackend:
    def __init__(self):
        self.absences = {"u-std": {"s1": 2, "s2": 5, "s3": 0}, "u-rep": {}}
        self.sessions = {}  # token -> user id
        self.calls = []
        self.join_code = "ASHUR-25"
        self.study_calls = []        # request bodies sent to study-ai
        self.study_mode = "ok"       # ok | too_long_once | user_limit | user_tries | busy_once | pace_once | daily_quota
        self._busy_done = False
        self._too_long_done = set()

    def study_ai(self, body):
        """Fake study-ai: answers in the same NDJSON stream format as the real function."""
        self.study_calls.append(body)
        if self.study_mode == "user_tries":
            # the per-student cap on calls (retries included), checked before anything is sent to Gemini
            return 429, {"ok": False, "error": "user_limit", "message": "حاولت هواية مرات اليوم لأن خدمة Gemini المجانية مزدحمة. كمّل باچر.", "message_en": "Too many attempts today."}
        if self.study_mode == "user_limit":
            # the student's daily parts are charged once Gemini starts answering, so this arrives in the stream
            return 200, [{"type": "error", "code": "user_limit", "message": "خلصت حصتك اليومية (10 أجزاء). تكدر تكمل باچر بنفس الوقت تقريباً.", "message_en": "You've used today's limit (10 parts)."}]
        if self.study_mode == "pace_once" and not self._busy_done:
            # the function's own department-wide per-minute pacing (before anything is sent to Gemini)
            self._busy_done = True
            return 429, {"ok": False, "error": "busy", "retry_after": 1, "message": "خدمة Gemini المجانية مزدحمة هسه. راح نعيد المحاولة تلقائياً.", "message_en": "Busy."}
        start, count = body.get("start", 1), body.get("count", 1)
        key = (body.get("task"), start, count, tuple(body.get("formats") or []), len(json.dumps(body.get("pieces"))))
        events = [{"type": "status", "phase": "thinking"}, {"type": "status", "phase": "writing"}]
        if self.study_mode == "busy_once" and not self._busy_done:
            # a per-minute 429 from Gemini, passed on with its retry delay
            self._busy_done = True
            return 200, events[:1] + [{"type": "error", "code": "busy", "retry_after": 1, "message": "خدمة Gemini المجانية مزدحمة هسه. راح نعيد المحاولة تلقائياً.", "message_en": "Busy."}]
        if self.study_mode == "daily_quota":
            return 200, events[:1] + [{"type": "error", "code": "daily_quota",
                                       "message": "خلصت الحصة المجانية اليومية لخدمة Gemini للقسم. ترجع تشتغل بعد منتصف الليل بتوقيت كاليفورنيا (حوالي الساعة 10 أو 11 الصبح بتوقيت بغداد).",
                                       "message_en": "The department's free daily Gemini quota is used up."}]
        long_text = body.get("numbering") == "part" and sum(len(x.get("text", "")) for x in body.get("pieces", [])) > 3000
        if self.study_mode == "too_long_once" and (count > 1 or long_text) and key not in self._too_long_done:
            self._too_long_done.add(key)
            events.append({"type": "error", "code": "too_long", "message": "الجزء طويل، راح نقسمه.", "message_en": "Too long."})
            return 200, events
        if body.get("task") == "translate":
            unit = {"page": "صفحة", "image": "صورة", "slide": "شريحة", "part": "جزء"}[body.get("numbering", "page")]
            out = []
            for n in range(start, start + count):
                out.append(f"--- {unit} {n} ---\n# الخلية (Cell) {n}\n\nالخلية هي **الوحدة الأساسية** للحياة.\n\n- الغشاء البلازمي (Plasma membrane)\n- السايتوبلازم (Cytoplasm)\n\n| التركيب | الوظيفة |\n|---|---|\n| النواة | التحكم |\n")
            text = "\n".join(out)
        else:
            data = {"topic": f"تركيب الخلية {start}", "notes": []}
            for f in body.get("formats") or []:
                data[f] = [_study_item(f, start * 10 + i, str(start)) for i in range(4)]
            text = json.dumps(data, ensure_ascii=False)
        half = len(text) // 2
        events += [{"type": "delta", "text": text[:half]}, {"type": "delta", "text": text[half:]}, {"type": "done", "stop": "end_turn"}]
        return 200, events

    def _user_for(self, headers):
        auth = headers.get("authorization", "")
        tok = auth.replace("Bearer ", "")
        return self.sessions.get(tok)

    def handle(self, route):
        req = route.request
        url = urlparse(req.url)
        path, qs = url.path, parse_qs(url.query)
        method = req.method
        self.calls.append(f"{method} {path}?{url.query}")
        hdrs = {k.lower(): v for k, v in req.headers.items()}

        def ok(body, status=200):
            route.fulfill(status=status, content_type="application/json",
                          headers={"access-control-allow-origin": "*"}, body=json.dumps(body, ensure_ascii=False))

        if method == "OPTIONS":
            return route.fulfill(status=200, headers={"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"})

        body = {}
        if req.post_data:
            try:
                body = json.loads(req.post_data)
            except Exception:
                body = {}

        # --- auth
        if path == "/auth/v1/token":
            if qs.get("grant_type") == ["password"]:
                uname = body.get("email", "").split("@")[0]
                u = USERS.get(uname)
                if not u or u["pin"] != body.get("password"):
                    return ok({"error": "invalid_grant", "error_description": "Invalid login credentials"}, 400)
                tok = f"tok-{uname}"
                self.sessions[tok] = u["profile"]["id"]
                return ok({"access_token": tok, "token_type": "bearer", "expires_in": 3600, "refresh_token": f"r-{uname}", "user": {"id": u["profile"]["id"]}})
            if qs.get("grant_type") == ["refresh_token"]:
                uname = body.get("refresh_token", "")[2:]
                tok = f"tok-{uname}"
                self.sessions[tok] = USERS[uname]["profile"]["id"]
                return ok({"access_token": tok, "token_type": "bearer", "expires_in": 3600, "refresh_token": f"r-{uname}", "user": {"id": USERS[uname]["profile"]["id"]}})
        if path == "/auth/v1/logout":
            return route.fulfill(status=204)

        # --- edge functions
        if path == "/functions/v1/register":
            if body.get("join_code", "").upper() != self.join_code:
                return ok({"ok": False, "error": "bad_join_code", "message": "رمز القسم غير صحيح. تأكد منه عند الممثل.", "message_en": "The department code is wrong."}, 403)
            return ok({"ok": True, "message": "تم إنشاء حسابك. دزينا اسم المستخدم ورمز الدخول على إيميلك.", "message_en": "Your account is ready. We emailed you your username and PIN."})
        if path == "/functions/v1/study-ai":
            if self._user_for(hdrs) is None:
                return ok({"ok": False, "error": "unauthorized", "message": "انتهت الجلسة.", "message_en": "Session expired."}, 401)
            status, res = self.study_ai(body)
            if isinstance(res, dict):
                return ok(res, status)
            return route.fulfill(status=200, content_type="application/x-ndjson; charset=utf-8", headers={"access-control-allow-origin": "*"},
                                 body="\n".join(json.dumps(e, ensure_ascii=False) for e in res) + "\n")
        if path == "/functions/v1/reset-pin":
            return ok({"ok": True, "message": "إذا الإيميل مسجل عندنا، راح يوصلك رمز دخول جديد خلال دقائق.", "message_en": "If this email is registered with us, a new PIN will arrive within a few minutes."})

        # --- REST
        m = re.match(r"^/rest/v1/(rpc/)?([a-z_]+)$", path)
        if not m:
            return ok({"message": "not found"}, 404)
        is_rpc, table = bool(m.group(1)), m.group(2)
        uid = self._user_for(hdrs)

        if table == "settings":
            if method == "PATCH":
                SETTINGS.update({k: v for k, v in body.items() if k in SETTINGS})
                return ok([SETTINGS])
            return ok([SETTINGS])
        if uid is None:
            return ok({"code": "42501", "message": "permission denied"}, 401)
        prof = next(u["profile"] for u in USERS.values() if u["profile"]["id"] == uid)
        staff = prof["role"] in ("rep", "owner")

        if is_rpc:
            if table == "get_join_code":
                return ok(self.join_code) if staff else ok({"message": "not_allowed"}, 400)
            if table == "set_join_code":
                self.join_code = body.get("p_code", "").upper()
                return ok(None)
            return ok(None)
        if table == "profiles":
            if method == "PATCH":
                prof.update({k: v for k, v in body.items() if k in ("full_name", "student_no")})
                return ok([prof])
            if "id" in qs:
                return ok([prof])
            return ok([u["profile"] for u in USERS.values()] if staff else [prof])
        if table == "subjects":
            return ok(SUBJECTS)
        if table == "schedule":
            return ok(SCHEDULE)
        if table == "announcements":
            return ok(ANNOUNCEMENTS)
        if table == "exams":
            return ok(EXAMS)
        if table == "materials":
            return ok(MATERIALS)
        if table == "absences":
            if method == "POST":
                rows = body if isinstance(body, list) else [body]
                for r in rows:
                    self.absences.setdefault(uid, {})[r["subject_id"]] = r["count"]
                return ok(rows, 201)
            return ok([{"subject_id": k, "count": v} for k, v in self.absences.get(uid, {}).items()])
        return ok([])
