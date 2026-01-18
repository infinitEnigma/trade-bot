/** @format */

import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { UserRole } from "@trade-bot/shared";
import { AppHeader } from "../components/ui/AppHeader";
import { Card } from "../components/ui/Card";
import { SectionHeader } from "../components/ui/SectionHeader";
import { ValidatedInput } from "../components/ui/ValidatedInput";
import {
  validateProfileForm,
  createInitialValidationState,
  ProfileValidationState
} from "../lib/validation";
import { SmartToast } from "../lib/toast";
import {
  Mail,
  Shield,
  Key,
  Settings as SettingsIcon,
  Save,
  AlertTriangle,
  Loader2
} from "lucide-react";

const Profile: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [validation, setValidation] = useState<ProfileValidationState>(createInitialValidationState());

  const [formData, setFormData] = useState({
    email: user?.email || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // Update validation when form data or editing state changes
  useEffect(() => {
    if (user?.email) {
      const newValidation = validateProfileForm(formData, user.email, isEditing);
      setValidation(newValidation);
    }
  }, [formData, user?.email, isEditing]);

  // Reset form when canceling edit
  const handleCancelEdit = () => {
    setFormData({
      email: user?.email || '',
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    });
    setIsEditing(false);
  };

  const handleSave = async () => {
    // Validate form before submission
    const currentValidation = validateProfileForm(formData, user?.email || '', isEditing);

    // Mark all fields as touched to show validation errors
    Object.keys(currentValidation).forEach(key => {
      if (key !== 'form' && currentValidation[key as keyof ProfileValidationState]) {
        (currentValidation[key as keyof ProfileValidationState] as any).touched = true;
      }
    });
    setValidation(currentValidation);

    // Check if form is valid
    if (!currentValidation.form.isValid) {
      SmartToast.error("Please correct the errors below before saving");
      return;
    }

    // Check if there are actual changes to save
    if (!currentValidation.form.hasEmailChanges && !currentValidation.form.hasPasswordChanges) {
      SmartToast.info("No changes to save");
      setIsEditing(false);
      return;
    }

    try {
      setIsSaving(true);

      // Prepare update payload
      const updatePayload: any = {};

      if (currentValidation.form.hasEmailChanges) {
        updatePayload.email = formData.email;
      }

      if (currentValidation.form.hasPasswordChanges) {
        updatePayload.currentPassword = formData.currentPassword;
        updatePayload.newPassword = formData.newPassword;
      }

      // Call the profile update API
      const response = await fetch('/api/user/profile/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(updatePayload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to update profile');
      }

      // Refresh user data
      await refreshUser();

      SmartToast.success("Profile updated successfully!");
      setIsEditing(false);

      // Reset password fields
      setFormData(prev => ({
        ...prev,
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      }));

    } catch (error) {
      SmartToast.error("Failed to update profile. Please try again.");
    } finally {
      setIsSaving(false);
    }
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
                onClick={() => isEditing ? handleCancelEdit() : setIsEditing(true)}
                className="btn-secondary flex items-center gap-2"
                disabled={isSaving}
              >
                <SettingsIcon className="w-4 h-4" />
                {isEditing ? 'Cancel' : 'Edit Profile'}
              </button>
            }
          />

          <Card className="p-6">
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {isEditing ? (
                  <ValidatedInput
                    label="Email Address"
                    type="email"
                    value={formData.email}
                    onChange={(value) => setFormData({...formData, email: value})}
                    validation={validation.email}
                    placeholder="Enter your email address"
                  />
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-text mb-2">
                      Email Address
                    </label>
                    <div className="flex items-center gap-3 p-3 bg-surface rounded-lg">
                      <Mail className="w-5 h-5 text-textMuted" />
                      <span className="text-text">{user.email}</span>
                    </div>
                  </div>
                )}

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
                    <ValidatedInput
                      label="Current Password"
                      type="password"
                      value={formData.currentPassword}
                      onChange={(value) => setFormData({...formData, currentPassword: value})}
                      validation={validation.currentPassword}
                      placeholder="Enter current password"
                      required
                    />

                    <ValidatedInput
                      label="New Password"
                      type="password"
                      value={formData.newPassword}
                      onChange={(value) => setFormData({...formData, newPassword: value})}
                      validation={validation.newPassword}
                      placeholder="Enter new password"
                      showStrengthIndicator
                      strength={validation.newPassword.strength}
                      required
                    />

                    <ValidatedInput
                      label="Confirm Password"
                      type="password"
                      value={formData.confirmPassword}
                      onChange={(value) => setFormData({...formData, confirmPassword: value})}
                      validation={validation.confirmPassword}
                      placeholder="Confirm new password"
                      required
                    />
                  </div>
                </div>
              )}

              {isEditing && (
                <div className="flex justify-end pt-6 border-t border-white/5">
                  <button
                    onClick={handleSave}
                    disabled={isSaving || !validation.form.isValid}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {isSaving ? 'Saving...' : 'Save Changes'}
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
