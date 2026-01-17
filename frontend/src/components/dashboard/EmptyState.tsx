/** @format */

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  variant?: "info" | "warning" | "success" | "error";
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  variant = "info",
}) => {
  const variantClasses = {
    info: "border-blue-500/20 bg-blue-500/5",
    warning: "border-yellow-500/20 bg-yellow-500/5",
    success: "border-green-500/20 bg-green-500/5",
    error: "border-red-500/20 bg-red-500/5",
  };

  return (
    <div
      className={`glass-card p-8 text-center border ${variantClasses[variant]}`}
    >
      <div className="w-16 h-16 rounded-full bg-linear-to-br from-primary/20 to-accent/20 flex items-center justify-center mx-auto mb-4">
        <div className="w-12 h-12 rounded-full bg-linear-to-br from-primary to-accent flex items-center justify-center">
          {icon}
        </div>
      </div>
      <h3 className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
      <p className="text-text-tertiary mb-6 max-w-md mx-auto">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="btn-primary inline-flex items-center gap-2"
        >
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
