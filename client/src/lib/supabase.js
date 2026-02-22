import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

console.log('🔧 Supabase Config:', {
  url: supabaseUrl,
  hasKey: !!supabaseAnonKey
})

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing Supabase environment variables!')
  console.error('VITE_SUPABASE_URL:', supabaseUrl)
  console.error('VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? '[SET]' : '[MISSING]')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,  // Automatically refresh tokens
    persistSession: true,     // Persist session in localStorage
    detectSessionInUrl: true  // Detect OAuth callback in URL
  }
})

/**
 * Subscribe to auth state changes
 */
export function onAuthStateChange(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback)
  return subscription
}

/**
 * Sign in with Google OAuth
 */
export async function signInWithGoogle() {
  console.log('🔐 Starting Google sign in...')
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      }
    }
  })
  
  if (error) {
    console.error('❌ Google sign in error:', error)
    throw error
  }
  
  console.log('✅ Google sign in initiated:', data)
  return data
}

/**
 * Sign out current user
 */
export async function signOut() {
  console.log('👋 Signing out...')
  const { error } = await supabase.auth.signOut()
  
  if (error) {
    console.error('❌ Sign out error:', error)
    throw error
  }
  
  console.log('✅ Signed out successfully')
}

/**
 * Get current session
 */
export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession()
  
  if (error) {
    console.error('❌ Get session error:', error)
    return null
  }
  
  return session
}

/**
 * Get current user
 */
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  
  if (error) {
    console.error('❌ Get user error:', error)
    return null
  }
  
  return user
}
