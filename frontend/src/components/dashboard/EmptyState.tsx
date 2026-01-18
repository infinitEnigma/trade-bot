/** @format */

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}

interface EmptyStateProps {
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "info" | "warning" | "success" | "error" | "neutral";
  layout?: "centered" | "inline" | "card";
  icon?: React.ReactNode;
  illustration?: React.ReactNode;
  title: string;
  subtitle?: string;
  description?: string;
  actions?: EmptyStateAction[];
  showBorder?: boolean;
  className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  size = "md",
  variant = "neutral",
  layout = "card",
  icon,
  illustration,
  title,
  subtitle,
  description,
  actions,
  showBorder = true,
  className = "",
}) => {
  const sizeClasses = {
    sm: {
      container: "p-4",
      iconWrapper: "w-12 h-12",
      iconInner: "w-8 h-8",
      illustration: "w-24 h-24",
      title: "text-base",
      subtitle: "text-sm",
      description: "text-sm",
      actions: "gap-2",
    },
    md: {
      container: "p-6",
      iconWrapper: "w-16 h-16",
      iconInner: "w-12 h-12",
      illustration: "w-32 h-32",
      title: "text-lg",
      subtitle: "text-base",
      description: "text-sm",
      actions: "gap-3",
    },
    lg: {
      container: "p-8",
      iconWrapper: "w-20 h-20",
      iconInner: "w-16 h-16",
      illustration: "w-40 h-40",
      title: "text-xl",
      subtitle: "text-lg",
      description: "text-base",
      actions: "gap-4",
    },
    xl: {
      container: "p-12",
      iconWrapper: "w-24 h-24",
      iconInner: "w-20 h-20",
      illustration: "w-48 h-48",
      title: "text-2xl",
      subtitle: "text-xl",
      description: "text-lg",
      actions: "gap-4",
    },
  };

  const variantClasses = {
    info: "border-blue-500/20 bg-blue-500/5",
    warning: "border-yellow-500/20 bg-yellow-500/5",
    success: "border-green-500/20 bg-green-500/5",
    error: "border-red-500/20 bg-red-500/5",
    neutral: "border-white/5 bg-surface/30",
  };

  const layoutClasses = {
    centered: "text-center",
    inline: "text-left flex items-center gap-6",
    card: "text-center",
  };

  const currentSize = sizeClasses[size];

  return (
    <div
      className={`${
        layout === "card" ? "glass-card" : ""
      } ${currentSize.container} ${layoutClasses[layout]} ${
        showBorder && layout === "card" ? `border ${variantClasses[variant]}` : ""
      } ${className}`}
    >
      {/* Illustration (for larger empty states) */}
      {illustration && size === "xl" && (
        <div className={`${currentSize.illustration} mx-auto mb-6 opacity-60`}>
          {illustration}
        </div>
      )}

      {/* Icon */}
      {icon && (
        <div className={`${currentSize.iconWrapper} rounded-full bg-linear-to-br from-primary/20 to-accent/20 flex items-center justify-center mx-auto mb-4`}>
          <div className={`${currentSize.iconInner} rounded-full bg-linear-to-br from-primary to-accent flex items-center justify-center`}>
            {icon}
          </div>
        </div>
      )}

      {/* Content */}
      <div className={layout === "inline" ? "flex-1" : ""}>
        <h3 className={`${currentSize.title} font-semibold text-text-primary mb-1`}>
          {title}
        </h3>

        {subtitle && (
          <p className={`${currentSize.subtitle} font-medium text-text-secondary mb-2`}>
            {subtitle}
          </p>
        )}

        {description && (
          <p className={`${currentSize.description} text-text-tertiary mb-6 max-w-md ${layout === "centered" ? "mx-auto" : ""}`}>
            {description}
          </p>
        )}
      </div>

      {/* Actions */}
      {actions && actions.length > 0 && (
        <div className={`flex ${layout === "centered" ? "justify-center" : "justify-start"} flex-wrap ${currentSize.actions}`}>
          {actions.map((action, index) => {
            const buttonClasses = {
              primary: "btn-primary",
              secondary: "btn-secondary",
              ghost: "btn-ghost",
            };

            return (
              <button
                key={index}
                onClick={action.onClick}
                className={`${buttonClasses[action.variant || "primary"]} inline-flex items-center gap-2`}
              >
                {action.icon}
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
