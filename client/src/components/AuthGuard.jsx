import { useState, useEffect } from 'react'
import { Box, Button, Typography, Paper, Avatar, Menu, MenuItem, Divider } from '@mui/material'
import { signInWithGoogle, signOut, onAuthStateChange } from '../lib/supabase'

export default function AuthGuard({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [anchorEl, setAnchorEl] = useState(null)

  useEffect(() => {
    // Subscribe to auth state changes
    const subscription = onAuthStateChange((event, session) => {
      console.log('Auth event:', event, session?.user?.email)
      setUser(session?.user ?? null)
      setLoading(false)

      // Handle token refresh
      if (event === 'TOKEN_REFRESHED') {
        console.log('✅ Token refreshed automatically')
      }

      // Handle sign out
      if (event === 'SIGNED_OUT') {
        console.log('👋 User signed out')
      }

      // Handle sign in
      if (event === 'SIGNED_IN') {
        console.log('👤 User signed in:', session?.user?.email)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleSignIn = async () => {
    try {
      await signInWithGoogle()
    } catch (error) {
      console.error('Sign in failed:', error)
      alert('Failed to sign in with Google. Please try again.')
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut()
      setAnchorEl(null)
      window.location.reload() // Refresh to clear state
    } catch (error) {
      console.error('Sign out failed:', error)
      alert('Failed to sign out. Please try again.')
    }
  }

  const handleMenuOpen = (event) => {
    setAnchorEl(event.currentTarget)
  }

  const handleMenuClose = () => {
    setAnchorEl(null)
  }

  // Loading state
  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        }}
      >
        <Paper elevation={3} sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
          <Typography variant="h6">Loading...</Typography>
        </Paper>
      </Box>
    )
  }

  // Not authenticated - show login page
  if (!user) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: 3,
        }}
      >
        <Paper
          elevation={6}
          sx={{
            maxWidth: 450,
            width: '100%',
            p: 5,
            borderRadius: 3,
            textAlign: 'center',
          }}
        >
          {/* Logo / Icon */}
          <Box
            sx={{
              width: 80,
              height: 80,
              margin: '0 auto 24px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="h3" sx={{ color: 'white', fontWeight: 'bold' }}>
              📄
            </Typography>
          </Box>

          {/* Title */}
          <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold', mb: 1 }}>
            DocFlow
          </Typography>

          <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 4 }}>
            AI-Powered Legal Document Analysis
          </Typography>

          {/* Features */}
          <Box sx={{ textAlign: 'left', mb: 4, px: 2 }}>
            <Typography variant="body2" sx={{ mb: 1.5, display: 'flex', alignItems: 'center' }}>
              ✨ <span style={{ marginLeft: 8 }}>Intelligent PDF field extraction</span>
            </Typography>
            <Typography variant="body2" sx={{ mb: 1.5, display: 'flex', alignItems: 'center' }}>
              🤖 <span style={{ marginLeft: 8 }}>AI-powered case analysis</span>
            </Typography>
            <Typography variant="body2" sx={{ mb: 1.5, display: 'flex', alignItems: 'center' }}>
              📊 <span style={{ marginLeft: 8 }}>Predictive case duration estimates</span>
            </Typography>
            <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
              🔒 <span style={{ marginLeft: 8 }}>Secure, private document storage</span>
            </Typography>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* Sign in button */}
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={handleSignIn}
            sx={{
              py: 1.5,
              background: 'white',
              color: '#333',
              border: '1px solid #ddd',
              textTransform: 'none',
              fontSize: '16px',
              fontWeight: 500,
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              '&:hover': {
                background: '#f8f8f8',
                boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
              },
            }}
          >
            <Box
              component="img"
              src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
              alt="Google"
              sx={{ width: 20, height: 20, mr: 2 }}
            />
            Sign in with Google
          </Button>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: 'block' }}>
            By signing in, you agree to secure storage of your documents
          </Typography>
        </Paper>
      </Box>
    )
  }

  // Authenticated - show app with user menu
  return (
    <>
      {/* User menu in top right */}
      <Box
        sx={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 1000,
        }}
      >
        <Button
          onClick={handleMenuOpen}
          sx={{
            borderRadius: '24px',
            px: 2,
            py: 1,
            background: 'white',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            '&:hover': {
              background: '#f5f5f5',
            },
          }}
        >
          <Avatar
            src={user.user_metadata?.avatar_url}
            alt={user.user_metadata?.full_name || user.email}
            sx={{ width: 32, height: 32, mr: 1 }}
          />
          <Typography variant="body2" sx={{ color: '#333', fontWeight: 500 }}>
            {user.user_metadata?.full_name || user.email}
          </Typography>
        </Button>

        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
          PaperProps={{
            sx: { mt: 1, minWidth: 200 },
          }}
        >
          <MenuItem disabled>
            <Box>
              <Typography variant="body2" fontWeight="bold">
                {user.user_metadata?.full_name || 'User'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user.email}
              </Typography>
            </Box>
          </MenuItem>
          <Divider />
          <MenuItem onClick={handleSignOut}>
            <Typography color="error">Sign Out</Typography>
          </MenuItem>
        </Menu>
      </Box>

      {/* Render the actual app */}
      {children}
    </>
  )
}
