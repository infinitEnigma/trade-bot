/** @format */

import { cva, type VariantProps } from "class-variance-authority";

export const buttonVariants = cva(
    "inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:pointer-events-none",
    {
        variants: {
            variant: {
                default:
                    "bg-gradient-to-r from-primary to-accent text-white hover:shadow-lg hover:shadow-primary/20",
                secondary:
                    "bg-surface border border-white/10 text-text-primary hover:border-primary/50",
                ghost: "hover:bg-white/5 text-text-secondary hover:text-text-primary",
                destructive:
                    "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20",
                success:
                    "bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20",
            },
            size: {
                sm: "h-9 px-3 text-sm",
                md: "h-11 px-4",
                lg: "h-12 px-6 text-base",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "md",
        },
    }
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;