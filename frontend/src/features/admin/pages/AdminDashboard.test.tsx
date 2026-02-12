import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter as Router } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { updateAuthUser } from '../../auth/hooks/useAuth';
import { UserLevel, UserRole } from '../../../shared/types';
import AdminDashboard from './AdminDashboard';

// Mock system API
vi.mock('../../../infrastructure/api/system', () => ({
  systemApi: {
    getSystemHealth: vi.fn(),
    getSystemMetrics: vi.fn(),
    getServiceStatus: vi.fn()
  }
}));

describe('AdminDashboard', () => {
  const queryClient = new QueryClient();
  const mockUser = {
    id: '1',
    email: 'admin@example.com',
    userLevel: UserLevel.VERIFIED,
    roles: [UserRole.SYSTEM_ADMIN]
  };

  // Setup mock user before each test
  beforeEach(() => {
    updateAuthUser(mockUser);
  });

  it('should render AdminDashboard with navigation tabs', () => {
    render(
      <Router>
        <QueryClientProvider client={queryClient}>
          <AdminDashboard />
        </QueryClientProvider>
      </Router>
    );

    expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('Bots')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('should show loading state when fetching data', () => {
    render(
      <Router>
        <QueryClientProvider client={queryClient}>
          <AdminDashboard />
        </QueryClientProvider>
      </Router>
    );

    const loadingSpinners = document.querySelectorAll('.animate-spin');
    expect(loadingSpinners.length).toBeGreaterThan(0);
  });

  it('should navigate to different tabs', () => {
    render(
      <Router>
        <QueryClientProvider client={queryClient}>
          <AdminDashboard />
        </QueryClientProvider>
      </Router>
    );

    fireEvent.click(screen.getByText('Users'));
    expect(screen.getByText('User Management')).toBeInTheDocument();
    expect(screen.getByText('User Management Coming Soon')).toBeInTheDocument();

    fireEvent.click(screen.getByText('System'));
    expect(screen.getByText('System Management')).toBeInTheDocument();
    expect(screen.getByText('System Management Coming Soon')).toBeInTheDocument();
  });
});
