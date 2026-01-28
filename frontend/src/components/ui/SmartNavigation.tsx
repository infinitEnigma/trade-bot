/** @format */

import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../features/auth";
import { UserRole } from "../../shared/types";
import {
  Home,
  Zap,
  BarChart3,
  Settings,
  Lock
} from "lucide-react";

interface NavItemProps {
  path: string;
  label: string;
  icon: React.ReactNode;
  available: boolean;
  current?: boolean;
  requires?: string;
  description: string;
}

const NavItem: React.FC<NavItemProps> = ({
  path,
  label,
  icon,
  available,
  current,
  requires,
  description
}) => {
  if (!available) {
    return (
      <div className="group relative">
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg opacity-50 cursor-not-allowed text-textMuted">
          {icon}
          <span className="text-sm">{label}</span>
          <Lock className="w-3 h-3" />
        </div>

        <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-50">
          <div className="glass-card p-3 text-center min-w-48 shadow-lg">
            <p className="text-sm font-medium text-text">{requires} Required</p>
            <p className="text-xs text-textMuted mt-1">{description}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Link
      to={path}
      className={`
        flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 hover-lift
        ${current
          ? "bg-primary/20 text-primary border border-primary/30"
          : "text-text-secondary hover:text-text-primary hover:bg-white/5"
        }
      `}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
      {current && (
        <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
      )}
    </Link>
  );
};

export const SmartNavigation: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();

  const navItems = [
    {
      path: '/dashboard',
      label: 'Dashboard',
      icon: <Home className="w-4 h-4" />,
      available: true,
      description: 'Overview of your trading activity'
    },
    {
      path: '/strategies',
      label: 'Strategies',
      icon: <Zap className="w-4 h-4" />,
      available: user?.userLevel === 'VERIFIED',
      requires: 'VERIFIED',
      description: 'Create and manage trading strategies'
    },
    {
      path: '/analytics',
      label: 'Analytics',
      icon: <BarChart3 className="w-4 h-4" />,
      available: user?.roles?.includes(UserRole.QUALIFIED_ALPHA) || false,
      requires: 'QUALIFIED_ALPHA',
      description: 'Advanced trading analytics and insights'
    },
    {
      path: '/settings',
      label: 'Settings',
      icon: <Settings className="w-4 h-4" />,
      available: true,
      description: 'Configure your trading preferences'
    }
  ];

  return (
    <nav className="flex items-center gap-2">
      {navItems.map(item => (
        <NavItem
          key={item.path}
          {...item}
          current={location.pathname === item.path}
        />
      ))}
    </nav>
  );
};
