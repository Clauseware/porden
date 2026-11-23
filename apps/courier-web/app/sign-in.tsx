'use client';
import { useState, type FormEvent } from 'react';
export default function SignIn() {
  const [status, setStatus] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get('password');
    try {
      const response = await fetch('/api/v1/session', {method: 'POST', credentials: 'include',
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password})});
      setStatus(response.ok ? 'Signed in. You can now approve a courier case.' : 'Sign-in failed. Check the demo password.');
    } catch {setStatus('Courier service unavailable.');}
  }
  return <form onSubmit={submit}><label>Demo password <input name="password" type="password" required autoComplete="current-password" /></label>
    <button type="submit">Sign in</button><p role="status">{status}</p></form>;
}
