import './globals.css'
import type { Metadata } from 'next'
import { Outfit } from 'next/font/google'

import { ToastProvider } from '@/components/Toast'

const outfit = Outfit({ subsets: ['latin'] })

export const metadata: Metadata = {
    title: 'ReStream Nexus',
    description: 'Seamless RTMP streaming proxy with Fallback integration',
    icons: {
        icon: '/favicon.ico',
    },
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="de">
            <body className={outfit.className}>
                <ToastProvider>
                    {children}
                </ToastProvider>
            </body>
        </html>
    )
}
