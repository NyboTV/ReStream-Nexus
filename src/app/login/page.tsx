'use client'
import { useState, useEffect } from 'react'
import axios from 'axios'
import Cookies from 'js-cookie'

export default function LoginPage() {
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    // Redirect to setup if not complete
    useEffect(() => {
        axios.get('/api/setup/status')
            .then(({ data }) => {
                if (!data.setupComplete) window.location.href = '/setup'
            })
            .catch(() => { })
    }, [])

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        try {
            const { data } = await axios.post('/api/setup/verify-password', { password })
            if (data.streamKey) {
                Cookies.set('streamKey', data.streamKey, { expires: 30 })
                window.location.href = '/'
            }
        } catch {
            setError('Falsches Passwort. Bitte erneut versuchen.')
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex-center">
            <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                    <span style={{ fontSize: '3rem' }}>⚡</span>
                    <h1 className="login-title" style={{ marginTop: '0.5rem' }}>ReStream Nexus</h1>
                    <p className="text-muted text-sm">Bitte melde dich an, um fortzufahren.</p>
                </div>

                <form onSubmit={handleLogin}>
                    <div className="form-group">
                        <label className="text-muted text-sm">Passwort</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                            className="form-control"
                            placeholder="Dein Passwort"
                            required
                            autoFocus
                        />
                    </div>
                    {error && <p className="text-sm mb-1" style={{ color: 'var(--danger)' }}>{error}</p>}
                    <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                        {loading ? 'Wird überprüft...' : 'Anmelden'}
                    </button>
                </form>
            </div>
        </div>
    )
}
