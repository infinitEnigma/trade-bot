/** @format */

import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { UserRole } from "@trade-bot/shared";
import { AppHeader } from "../components/ui/AppHeader";
import { Card } from "../components/ui/Card";
import { SectionHeader } from "../components/ui/SectionHeader";
import {
  Mail,
  Shield,
  Key,
  Settings as SettingsIcon,
  Save,
  AlertTriangle
} from "lucide-react";

const Profile: React.FC = () => {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    email: user?.email || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const handleSave = async () => {
    // TODO: Implement profile update logic
    console.log('Saving profile:', formData);
    setIsEditing(false);
  };

  if (!user) return null;

  return (
    <div className="container mx-auto px-4 py-10 space-y-10 bg-background">
      <AppHeader
        title="Profile Settings"
        subtitle="Manage your account information and preferences"
      />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Profile Overview */}
        <div className="mb-8">
          <Card className="p-8">
            <div className="flex items-center gap-6">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-linear-to-br from-primary to-accent flex items-center justify-center text-2xl font-bold text-white">
                  {user.email?.[0]?.toUpperCase() || 'U'}
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-bg-surface bg-green-500"></div>
              </div>

              <div className="flex-1">
                <h2 className="text-2xl font-bold text-text mb-1">
                  {user.email?.split('@')[0] || 'User'}
                </h2>
                <p className="text-textMuted mb-2">{user.email}</p>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-primary capitalize">
                      {user.userLevel.toLowerCase()}
                    </span>
                  </div>

                  {user.roles && user.roles.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Key className="w-4 h-4 text-amber-400" />
                      <span className="text-sm font-medium text-amber-400">
                        {user.roles.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Account Information */}
        <div className="mb-8">
          <SectionHeader
            title="Account Information"
            subtitle="Update your basic account details"
            actions={
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="btn-secondary flex items-center gap-2"
              >
                <SettingsIcon className="w-4 h-4" />
                {isEditing ? 'Cancel' : 'Edit Profile'}
              </button>
            }
          />

          <Card className="p-6">
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Email Address
                  </label>
                  <div className="flex items-center gap-3 p-3 bg-surface rounded-lg">
                    <Mail className="w-5 h-5 text-textMuted" />
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                      disabled={!isEditing}
                      className="flex-1 bg-transparent border-none outline-none text-text disabled:text-textMuted"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Account Level
                  </label>
                  <div className="flex items-center gap-3 p-3 bg-surface rounded-lg">
                    <Shield className="w-5 h-5 text-primary" />
                    <span className="text-text font-medium capitalize">
                      {user.userLevel.toLowerCase()}
                    </span>
                  </div>
                </div>
              </div>

              {isEditing && (
                <div className="pt-6 border-t border-white/5">
                  <h3 className="text-lg font-semibold text-text mb-4">Change Password</h3>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-text mb-2">
                        Current Password
                      </label>
                      <input
                        type="password"
                        value={formData.currentPassword}
                        onChange={(e) => setFormData({...formData, currentPassword: e.target.value})}
                        className="input w-full"
                        placeholder="Enter current password"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text mb-2">
                        New Password
                      </label>
                      <input
                        type="password"
                        value={formData.newPassword}
                        onChange={(e) => setFormData({...formData, newPassword: e.target.value})}
                        className="input w-full"
                        placeholder="Enter new password"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text mb-2">
                        Confirm Password
                      </label>
                      <input
                        type="password"
                        value={formData.confirmPassword}
                        onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                        className="input w-full"
                        placeholder="Confirm new password"
                      />
                    </div>
                  </div>
                </div>
              )}

              {isEditing && (
                <div className="flex justify-end pt-6 border-t border-white/5">
                  <button
                    onClick={handleSave}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    Save Changes
                  </button>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Account Status */}
        <div className="mb-8">
          <SectionHeader
            title="Account Status"
            subtitle="Your current account permissions and roles"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Shield className="w-6 h-6 text-primary" />
                <h3 className="text-lg font-semibold text-text">Account Level</h3>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-textMuted">Current Level</span>
                  <span className="font-medium text-primary capitalize">
                    {user.userLevel.toLowerCase()}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-textMuted">Dashboard Access</span>
                  <span className="text-green-400">✓ Available</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-textMuted">Strategies Access</span>
                  <span className={user.userLevel === 'VERIFIED' ? 'text-green-400' : 'text-red-400'}>
                    {user.userLevel === 'VERIFIED' ? '✓ Available' : '✗ Requires VERIFIED'}
                  </span>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Key className="w-6 h-6 text-amber-400" />
                <h3 className="text-lg font-semibold text-text">Special Roles</h3>
              </div>

              <div className="space-y-3">
                {user.roles && user.roles.length > 0 ? (
                  user.roles.map(role => (
                    <div key={role} className="flex justify-between items-center">
                      <span className="text-textMuted capitalize">
                        {role.replace('_', ' ').toLowerCase()}
                      </span>
                      <span className="text-amber-400 font-medium">✓ Active</span>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-4">
                    <p className="text-textMuted text-sm">No special roles assigned</p>
                    <p className="text-textMuted text-xs mt-1">
                      Roles are granted through qualification checks
                    </p>
                  </div>
                )}

                <div className="flex justify-between items-center pt-2 border-t border-white/5">
                  <span className="text-textMuted">Analytics Access</span>
                  <span className={user.roles?.includes(UserRole.QUALIFIED_ALPHA) ? 'text-green-400' : 'text-red-400'}>
                    {user.roles?.includes(UserRole.QUALIFIED_ALPHA) ? '✓ Available' : '✗ Requires Qualification'}
                  </span>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Security Notice */}
        <Card className="p-6 bg-amber-500/5 border border-amber-500/20">
          <div className="flex items-start gap-4">
            <AlertTriangle className="w-6 h-6 text-amber-400 mt-0.5" />
            <div>
              <h3 className="text-lg font-semibold text-text mb-2">Security Information</h3>
              <div className="space-y-2 text-sm text-textMuted">
                <p>• Your password is encrypted and securely stored</p>
                <p>• Two-factor authentication is recommended for enhanced security</p>
                <p>• Account roles and permissions are regularly audited</p>
                <p>• All profile changes are logged for security purposes</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Profile;
