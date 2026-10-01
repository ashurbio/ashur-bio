# بوابة قسم علوم الحياة — الكود المصدري

تطبيق ويب للقسم: جدول، إعلانات، امتحانات، محاضرات، غيابات، ولوحة للممثل.
الواجهة React (Vite)، والسيرفر وقاعدة البيانات على Supabase، والإيميلات عن طريق Brevo.

## محتويات المجلد

| المسار | شنو بيه |
|---|---|
| `web/` | كود الواجهة (الصفحات، التصميم، تسجيل الدخول) |
| `web/src/sb/config.js` | رابط مشروع Supabase والمفتاح العام (مسموح يكون علني، الحماية بقواعد RLS) |
| `web/src/sb/client.js` | الاتصال بالسيرفر وحفظ تسجيل الدخول |
| `web/src/sb/screens.jsx` | شاشات الطالب |
| `web/src/sb/admin.jsx` | لوحة الممثل |
| `supabase/functions/register` | إنشاء حساب ودز اسم المستخدم والرمز بالإيميل |
| `supabase/functions/reset-pin` | «نسيت الرمز» |
| `supabase/functions/mail-status` | فحص إعدادات الإيميل (يشتغل بس بمفتاح الاختبار) |
| `supabase/functions/_shared/common.ts` | دوال مشتركة: نص الإيميل، الإرسال، الحد من المحاولات |
| `supabase/schema.sql` | قاعدة البيانات كاملة: الجداول، قواعد الأمان، الصلاحيات |

**ما بيه أي مفتاح سري.** مفتاح Brevo ورمز القسم محفوظين داخل قاعدة البيانات فقط.

## تشغيله على جهازك

يحتاج Node.js 18 أو أحدث.

```bash
cd web
npm install
npm run dev      # يفتح نسخة تجريبية على localhost
npm run build    # يطلع الموقع الجاهز بمجلد dist
```

## تحديث الموقع المنشور (GitHub Pages)

1. `npm run build` داخل `web`.
2. انسخ محتويات `web/dist` إلى مستودع الموقع (تحذف مجلد `assets` القديم أول).
3. commit و push على فرع `main`.

## إذا تريد تنقله لمشروع Supabase جديد

1. سوّي مشروع جديد بـ Supabase.
2. افتح SQL Editor، الصق `supabase/schema.sql`، وغيّر القيم بقسم «Initial data» بآخره (رمز القسم، إيميل المرسل، رابط التطبيق) قبل التشغيل.
3. انشر الدوال: `supabase functions deploy register reset-pin mail-status --no-verify-jwt`.
4. حط مفتاح Brevo إما بجدول `private.config` أو كـ secret باسم `BREVO_API_KEY`.
5. غيّر `SUPABASE_URL` و `SUPABASE_KEY` بملف `web/src/sb/config.js` لقيم المشروع الجديد، وابنِ الموقع من جديد.

أول حساب يتسجل بالمشروع الجديد يصير هو المالك.
