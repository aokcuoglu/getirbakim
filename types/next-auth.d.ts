import 'next-auth'

declare module 'next-auth' {
  interface User {
    role?: string | null
  }
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role?: string | null
      image?: string | null
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role?: string | null
  }
}
