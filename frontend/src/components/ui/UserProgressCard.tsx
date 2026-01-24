/** @format */

import React from "react";
import { useAuth } from "../../features/auth";
import { User, UserLevel, UserRole } from "@trade-bot/shared";
import {
  CheckCircle,
  Lock,
  Shield,
  Wallet,
  TrendingUp,
  Award,
  UserCheck
} from "lucide-react";

interface ProgressStep {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  current?: boolean;
  icon: React.ReactNode;
}

export const UserProgressCard: React.FC = () => {
  const { user } = useAuth();

  if (!user) return null;

  const steps: ProgressStep[] = [
    {
      id: 'basic',
      label: 'Account Created',
      description: 'Successfully registered and verified email',
      completed: user.userLevel === UserLevel.BASIC || user.userLevel === UserLevel.REGISTERED || user.userLevel === UserLevel.VERIFIED,
      icon: <UserCheck className="w-4 h-4" />
    },
    {
      id: 'registered',
      label: 'Trading Verified',
      description: 'Connected and verified Kodiak trading account',
      completed: user.userLevel === UserLevel.REGISTERED || user.userLevel === UserLevel.VERIFIED,
      current: user.userLevel === UserLevel.BASIC,
      icon: <Wallet className="w-4 h-4" />
    },
    {
      id: 'verified',
      label: 'Wallet Verified',
      description: 'Wallet address verified and linked to account',
      completed: user.userLevel === UserLevel.VERIFIED,
      current: user.userLevel === UserLevel.REGISTERED,
      icon: <CheckCircle className="w-4 h-4" />
    },
    {
      id: 'qualified_alpha',
      label: 'Alpha Access',
      description: 'Qualified for private testing features',
      completed: (user.roles && user.roles.includes(UserRole.QUALIFIED_ALPHA)) || false,
      current: user.userLevel === UserLevel.VERIFIED && (!user.roles || !user.roles.includes(UserRole.QUALIFIED_ALPHA)),
      icon: <Shield className="w-4 h-4" />
    }
  ];

  const completedSteps = steps.filter(step => step.completed).length;
  const progressPercentage = (completedSteps / steps.length) * 100;

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-text">Account Progress</h3>
          <p className="text-sm text-textMuted">Your journey to advanced trading</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-primary">{completedSteps}/{steps.length}</div>
          <div className="text-xs text-textMuted">Steps completed</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="w-full bg-surface rounded-full h-2">
          <div
            className="bg-linear-to-r from-primary to-accent h-2 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-textMuted">
          <span>{Math.round(progressPercentage)}% Complete</span>
          <span>Next: {getNextStepLabel(user)}</span>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="space-y-4">
        {steps.map((step, index) => (
          <ProgressStepItem
            key={step.id}
            step={step}
            isLast={index === steps.length - 1}
          />
        ))}
      </div>

      {/* Next Action Prompt */}
      <NextActionPrompt user={user} />
    </div>
  );
};

const ProgressStepItem: React.FC<{
  step: ProgressStep;
  isLast: boolean;
}> = ({ step, isLast }) => (
  <div className="flex items-start gap-4">
    {/* Step Indicator */}
    <div className="flex flex-col items-center">
      <div className={`
        w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all
        ${step.completed
          ? 'bg-green-500 border-green-500 text-white'
          : step.current
            ? 'bg-primary border-primary text-white animate-pulse'
            : 'bg-surface border-textMuted text-textMuted'
        }
      `}>
        {step.completed ? (
          <CheckCircle className="w-4 h-4" />
        ) : step.current ? (
          step.icon
        ) : (
          <Lock className="w-4 h-4" />
        )}
      </div>
      {!isLast && (
        <div className={`
          w-0.5 h-8 mt-2 transition-colors
          ${step.completed ? 'bg-green-500' : 'bg-textMuted/30'}
        `} />
      )}
    </div>

    {/* Step Content */}
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <h4 className={`
          font-medium transition-colors
          ${step.completed
            ? 'text-green-400'
            : step.current
              ? 'text-primary'
              : 'text-textMuted'
          }
        `}>
          {step.label}
        </h4>
        {step.current && (
          <span className="px-2 py-0.5 text-xs bg-primary/20 text-primary rounded-full animate-pulse">
            Current
          </span>
        )}
      </div>
      <p className={`
        text-sm transition-colors
        ${step.completed || step.current ? 'text-text' : 'text-textMuted'}
      `}>
        {step.description}
      </p>
    </div>
  </div>
);

const NextActionPrompt: React.FC<{ user: User }> = ({ user }) => {
  if (user.roles && user.roles.includes(UserRole.QUALIFIED_ALPHA)) {
    return (
      <div className="mt-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
        <div className="flex items-center gap-3">
          <Award className="w-5 h-5 text-green-400" />
          <div>
            <h4 className="font-medium text-green-400">Alpha Access Granted!</h4>
            <p className="text-sm text-textMuted">You have full access to advanced trading features.</p>
          </div>
        </div>
      </div>
    );
  }

  if (user.userLevel === UserLevel.VERIFIED) {
    return (
      <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-amber-400" />
          <div>
            <h4 className="font-medium text-amber-400">Ready for Alpha Access</h4>
            <p className="text-sm text-textMuted mb-2">
              Check your wallet qualification to unlock advanced bot controls.
            </p>
            <button className="text-sm bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 px-3 py-1 rounded transition-colors">
              Check Qualification →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (user.userLevel === UserLevel.REGISTERED) {
    return (
      <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-blue-400" />
          <div>
            <h4 className="font-medium text-blue-400">Next: Connect Trading Account</h4>
            <p className="text-sm text-textMuted mb-2">
              Set up your Kodiak trading account to access strategies and start trading.
            </p>
            <button className="text-sm bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 px-3 py-1 rounded transition-colors">
              Go to Settings →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

const getNextStepLabel = (user: User): string => {
  if (user.roles && user.roles.includes(UserRole.QUALIFIED_ALPHA)) {
    return "Complete";
  }
  if (user.userLevel === UserLevel.VERIFIED) {
    return "Alpha Access";
  }
  if (user.userLevel === UserLevel.REGISTERED) {
    return "Wallet Verification";
  }
  if (user.userLevel === UserLevel.BASIC) {
    return "Trading Setup";
  }
  return "Account Setup";
};
