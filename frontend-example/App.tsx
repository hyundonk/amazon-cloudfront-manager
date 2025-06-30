import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import { Amplify, Auth } from 'aws-amplify';
import { 
  AppLayout, 
  Button, 
  Container, 
  Header, 
  SideNavigation, 
  SpaceBetween,
  TopNavigation
} from '@cloudscape-design/components';

// Import pages
import DistributionsList from './pages/DistributionsList';
import DistributionDetail from './pages/DistributionDetail';
import DistributionCreate from './pages/DistributionCreate';
import TemplatesList from './pages/TemplatesList';
import TemplateDetail from './pages/TemplateDetail';
import TemplateCreate from './pages/TemplateCreate';
import Login from './pages/Login';

// Import context
import { AuthContext } from './context/AuthContext';

// Configure Amplify
Amplify.configure({
  Auth: {
    region: process.env.REACT_APP_REGION,
    userPoolId: process.env.REACT_APP_USER_POOL_ID,
    userPoolWebClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID,
  },
  API: {
    endpoints: [
      {
        name: 'cfManagerApi',
        endpoint: process.env.REACT_APP_API_URL,
        custom_header: async () => {
          const session = await Auth.currentSession();
          return {
            Authorization: `Bearer ${session.getIdToken().getJwtToken()}`,
          };
        },
      },
    ],
  },
});

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    checkAuthState();
  }, []);

  async function checkAuthState() {
    try {
      const userData = await Auth.currentAuthenticatedUser();
      setUser(userData);
      setIsAuthenticated(true);
    } catch (error) {
      setUser(null);
      setIsAuthenticated(false);
    }
    setIsLoading(false);
  }

  async function handleSignOut() {
    try {
      await Auth.signOut();
      setUser(null);
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Login onLogin={checkAuthState} />;
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, checkAuthState }}>
      <Router>
        <AppLayout
          navigation={
            <SideNavigation
              header={{ text: 'CloudFront Manager', href: '/' }}
              items={[
                { type: 'link', text: 'Distributions', href: '/' },
                { type: 'link', text: 'Templates', href: '/templates' },
              ]}
            />
          }
          toolsHide={true}
          content={
            <Routes>
              <Route path="/" element={<DistributionsList />} />
              <Route path="/distributions/create" element={<DistributionCreate />} />
              <Route path="/distributions/:id" element={<DistributionDetail />} />
              <Route path="/templates" element={<TemplatesList />} />
              <Route path="/templates/create" element={<TemplateCreate />} />
              <Route path="/templates/:id" element={<TemplateDetail />} />
            </Routes>
          }
          headerSelector="#header"
        />
        <div id="header">
          <TopNavigation
            identity={{
              href: '/',
              title: 'CloudFront Manager',
            }}
            utilities={[
              {
                type: 'button',
                text: 'Sign out',
                onClick: handleSignOut,
              },
              {
                type: 'menu-dropdown',
                text: user?.attributes?.email || 'User',
                items: [
                  { id: 'profile', text: 'Profile' },
                  { id: 'signout', text: 'Sign out', onClick: handleSignOut },
                ],
              },
            ]}
          />
        </div>
      </Router>
    </AuthContext.Provider>
  );
};

export default App;
