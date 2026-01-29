import './globals.css'

export const metadata = {
  title: 'Sol Tracker',
  description: 'Solana wallet trade tracker and analyzer',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
