import type { Metadata } from 'next'
import { Archivo } from 'next/font/google'
import SiteNav from '@/components/site-nav'
import './globals.css'

const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin', 'latin-ext'],
  weight: 'variable',
  axes: ['wdth'],
})

export const metadata: Metadata = {
  title: 'Flight Log Remastered',
  description: 'A modern frontend over flightlog.org',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${archivo.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SiteNav />
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
      </body>
    </html>
  )
}
