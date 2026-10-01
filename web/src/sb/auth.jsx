import React, { useRef, useState } from 'react';
import { callFunction } from './client';
import { useStore } from './store';
import { CellMark } from './ui';
import { b, Bi } from './bi';
import { uniBi, deptBi } from './util';

function PinInput({ value, onChange, disabled }) {
  const refs = useRef([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '');
  const setAt = (i, ch) => {
    const arr = digits.slice();
    arr[i] = ch;
    onChange(arr.join('').slice(0, 6));
  };
  const onInput = (i, e) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) { setAt(i, ''); return; }
    if (raw.length > 1) { // paste or autofill into one box
      const merged = (digits.slice(0, i).join('') + raw).slice(0, 6);
      onChange(merged);
      refs.current[Math.min(merged.length, 5)]?.focus();
      return;
    }
    setAt(i, raw);
    if (i < 5) refs.current[i + 1]?.focus();
  };
  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) { e.preventDefault(); setAt(i - 1, ''); refs.current[i - 1]?.focus(); }
  };
  const onPaste = (e) => {
    const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (t) { e.preventDefault(); onChange(t); refs.current[Math.min(t.length, 5)]?.focus(); }
  };
  return (
    <div className="pin" dir="ltr" onPaste={onPaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d}
          onChange={(e) => onInput(i, e)}
          onKeyDown={(e) => onKey(i, e)}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={6}
          aria-label={`الرقم ${i + 1} من رمز الدخول / PIN digit ${i + 1}`}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

export default function AuthScreen() {
  const { settings, signIn, authNotice } = useStore();
  const [mode, setMode] = useState('login'); // login | register | registered | forgot | forgot-sent
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [reg, setReg] = useState({ full_name: '', email: '', student_no: '', join_code: '' });
  const [forgotEmail, setForgotEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const go = (m) => { setMode(m); setErr(''); setMsg(''); };

  async function doLogin(e) {
    e.preventDefault();
    if (!/^[a-z0-9-]{4,20}$/.test(username.trim().toLowerCase())) { setErr(b('اكتب اسم المستخدم مثل ما وصلك بالإيميل (مثال: bio-k7m2x).', 'Enter the username from your email (e.g. bio-k7m2x).')); return; }
    if (!/^\d{6}$/.test(pin)) { setErr(b('رمز الدخول 6 أرقام.', 'The PIN is 6 digits.')); return; }
    setBusy(true); setErr('');
    try { await signIn(username, pin); } catch (e2) { setErr(e2.message); setBusy(false); }
  }

  async function doRegister(e) {
    e.preventDefault();
    const r = { ...reg, full_name: reg.full_name.trim(), email: reg.email.trim(), student_no: reg.student_no.trim(), join_code: reg.join_code.trim() };
    if (r.full_name.length < 3) { setErr(b('اكتب اسمك الثلاثي.', 'Enter your full name.')); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) { setErr(b('اكتب إيميل صحيح.', 'Enter a valid email.')); return; }
    if (!r.join_code) { setErr(b('اكتب رمز القسم اللي أعطاك إياه الممثل.', 'Enter the department code your representative gave you.')); return; }
    setBusy(true); setErr('');
    const res = await callFunction('register', r);
    setBusy(false);
    if (res.ok) { setMsg(res.message); setMode('registered'); } else setErr(res.message);
  }

  async function doForgot(e) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(forgotEmail.trim())) { setErr(b('اكتب إيميل صحيح.', 'Enter a valid email.')); return; }
    setBusy(true); setErr('');
    const res = await callFunction('reset-pin', { email: forgotEmail.trim() });
    setBusy(false);
    if (res.ok) { setMsg(res.message); setMode('forgot-sent'); } else setErr(res.message);
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <CellMark size={44} />
          <div>
            <div className="uni"><Bi t={uniBi(settings)} /></div>
            <div className="dept"><Bi t={deptBi(settings, false)} /></div>
          </div>
        </div>

        {mode === 'login' && (
          <form onSubmit={doLogin} className="auth-form" noValidate>
            <h1><Bi t={b('تسجيل الدخول', 'Sign in')} /></h1>
            {authNotice ? <div className="notice alert"><Bi t={authNotice} /></div> : null}
            <div className="field">
              <label htmlFor="login-user"><Bi t={b('اسم المستخدم', 'Username')} /></label>
              <input id="login-user" dir="ltr" autoCapitalize="none" autoCorrect="off" spellCheck="false" autoComplete="username"
                placeholder="bio-xxxxx" value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <span className="label"><Bi t={b('رمز الدخول (PIN)', 'Access PIN')} /></span>
              <PinInput value={pin} onChange={setPin} disabled={busy} />
            </div>
            {err ? <div className="form-err" role="alert"><Bi t={err} /></div> : null}
            <button className="btn block" type="submit" disabled={busy}><Bi t={busy ? b('جارٍ الدخول…', 'Signing in…') : b('دخول', 'Sign in')} /></button>
            <div className="auth-links">
              <button type="button" className="link" onClick={() => go('forgot')}>{<Bi t={b('نسيت الرمز؟', 'Forgot your PIN?')} />}</button>
              <button type="button" className="link" onClick={() => go('register')}>{<Bi t={b('ما عندك حساب؟ سجّل', 'No account? Register')} />}</button>
            </div>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={doRegister} className="auth-form" noValidate>
            <h1><Bi t={b('حساب جديد', 'New account')} /></h1>
            <p className="muted"><Bi t={b('يوصلك اسم المستخدم ورمز الدخول على إيميلك. كل طالب يحصل على معلومات دخول خاصة بيه.', 'Your username and PIN are sent to your email. Every student gets private login details.')} /></p>
            <div className="field">
              <label htmlFor="reg-name"><Bi t={b('الاسم الثلاثي', 'Full name')} /><span className="req">*</span></label>
              <input id="reg-name" autoComplete="name" maxLength={80} value={reg.full_name} onChange={(e) => setReg({ ...reg, full_name: e.target.value })} disabled={busy} />
            </div>
            <div className="field">
              <label htmlFor="reg-email"><Bi t={b('الإيميل', 'Email')} /><span className="req">*</span></label>
              <input id="reg-email" type="email" dir="ltr" autoComplete="email" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} disabled={busy} />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="reg-no"><Bi t={b('الرقم الجامعي', 'Student ID')} /></label>
                <input id="reg-no" dir="ltr" inputMode="numeric" maxLength={30} value={reg.student_no} onChange={(e) => setReg({ ...reg, student_no: e.target.value })} disabled={busy} />
              </div>
              <div className="field">
                <label htmlFor="reg-code"><Bi t={b('رمز القسم', 'Department code')} /><span className="req">*</span></label>
                <input id="reg-code" dir="ltr" autoCapitalize="characters" placeholder="BIO-0000" value={reg.join_code} onChange={(e) => setReg({ ...reg, join_code: e.target.value })} disabled={busy} />
              </div>
            </div>
            {err ? <div className="form-err" role="alert"><Bi t={err} /></div> : null}
            <button className="btn block" type="submit" disabled={busy}><Bi t={busy ? b('جارٍ إنشاء الحساب…', 'Creating account…') : b('إنشاء الحساب', 'Create account')} /></button>
            <div className="auth-links"><button type="button" className="link" onClick={() => go('login')}>{<Bi t={b('عندي حساب، أريد أدخل', 'I have an account — sign in')} />}</button></div>
          </form>
        )}

        {mode === 'registered' && (
          <div className="auth-form">
            <h1><Bi t={b('تم إنشاء حسابك', 'Account created')} /></h1>
            <div className="notice ok"><Bi t={msg || b('دزينا اسم المستخدم ورمز الدخول على إيميلك.', 'We emailed you your username and PIN.')} /></div>
            <p className="muted"><Bi t={b('إذا ما لكيت الرسالة خلال دقائق، شوف مجلد الرسائل غير المرغوبة (Spam).', 'If you can\'t find the email within a few minutes, check your Spam folder.')} /></p>
            <button className="btn block" type="button" onClick={() => go('login')}>{<Bi t={b('روح لتسجيل الدخول', 'Go to sign in')} />}</button>
          </div>
        )}

        {mode === 'forgot' && (
          <form onSubmit={doForgot} className="auth-form" noValidate>
            <h1><Bi t={b('نسيت الرمز', 'Forgot your PIN')} /></h1>
            <p className="muted"><Bi t={b('اكتب الإيميل اللي سجلت بيه، ويوصلك اسم المستخدم ورمز دخول جديد.', 'Enter the email you registered with and we\'ll send your username and a new PIN.')} /></p>
            <div className="field">
              <label htmlFor="forgot-email"><Bi t={b('الإيميل', 'Email')} /></label>
              <input id="forgot-email" type="email" dir="ltr" autoComplete="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} disabled={busy} />
            </div>
            {err ? <div className="form-err" role="alert"><Bi t={err} /></div> : null}
            <button className="btn block" type="submit" disabled={busy}><Bi t={busy ? b('جارٍ الإرسال…', 'Sending…') : b('أرسل رمز جديد', 'Send a new PIN')} /></button>
            <div className="auth-links"><button type="button" className="link" onClick={() => go('login')}>{<Bi t={b('رجوع لتسجيل الدخول', 'Back to sign in')} />}</button></div>
          </form>
        )}

        {mode === 'forgot-sent' && (
          <div className="auth-form">
            <h1><Bi t={b('تحقق من إيميلك', 'Check your email')} /></h1>
            <div className="notice ok"><Bi t={msg} /></div>
            <button className="btn block" type="button" onClick={() => go('login')}>{<Bi t={b('روح لتسجيل الدخول', 'Go to sign in')} />}</button>
          </div>
        )}
      </div>
    </main>
  );
}
