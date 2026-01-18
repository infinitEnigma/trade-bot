/** @format */

import React from "react";
import { FieldValidation } from "../../lib/validation";
import { AlertCircle, CheckCircle } from "lucide-react";

interface ValidatedInputProps {
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  validation: FieldValidation;
  placeholder?: string;
  required?: boolean;
  showStrengthIndicator?: boolean;
  strength?: {
    score: number;
    strength: 'weak' | 'medium' | 'strong';
  };
  className?: string;
}

export const ValidatedInput: React.FC<ValidatedInputProps> = ({
  label,
  type,
  value,
  onChange,
  onBlur,
  validation,
  placeholder,
  required = false,
  showStrengthIndicator = false,
  strength,
  className = ""
}) => {
  const getInputClasses = () => {
    const baseClasses = "input w-full transition-all duration-200";

    if (!validation.touched) {
      return baseClasses;
    }

    if (validation.isValid) {
      return `${baseClasses} border-green-400 focus:border-green-400`;
    } else {
      return `${baseClasses} border-red-400 focus:border-red-400`;
    }
  };

  const getValidationIcon = () => {
    if (!validation.touched) return null;

    if (validation.isValid) {
      return <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />;
    } else {
      return <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />;
    }
  };

  const getStrengthBarColor = () => {
    if (!strength) return 'bg-gray-300';

    switch (strength.strength) {
      case 'weak': return 'bg-red-500';
      case 'medium': return 'bg-yellow-500';
      case 'strong': return 'bg-green-500';
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <label className="block text-sm font-medium text-text">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
      </label>

      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          className={`${getInputClasses()} pr-10`}
        />

        {/* Validation Icon */}
        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
          {getValidationIcon()}
        </div>
      </div>

      {/* Password Strength Indicator */}
      {showStrengthIndicator && strength && value && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-textMuted">Password Strength</span>
            <span className={`font-medium capitalize ${
              strength.strength === 'weak' ? 'text-red-400' :
              strength.strength === 'medium' ? 'text-yellow-400' :
              'text-green-400'
            }`}>
              {strength.strength}
            </span>
          </div>
          <div className="w-full bg-surface rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all duration-300 ${getStrengthBarColor()}`}
              style={{ width: `${strength.score}%` }}
            />
          </div>
        </div>
      )}

      {/* Validation Message */}
      {validation.touched && !validation.isValid && validation.message && (
        <p className="text-red-400 text-xs flex items-center gap-1">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {validation.message}
        </p>
      )}
    </div>
  );
};
