/** @format */

import { ReactNode } from "react";

export type ErrorType =
    | "network"
    | "auth"
    | "permission"
    | "validation"
    | "server"
    | "timeout"
    | "not-found"
    | "maintenance"
    | "rate-limit"
    | "unknown";

export interface ErrorAction {
    label: string;
    onClick: () => void;
    icon?: ReactNode;
    variant?: "primary" | "secondary" | "ghost";
    disabled?: boolean;
}

export interface ErrorStateProps {
    type?: ErrorType;
    title?: string;
    message?: string;
    description?: string;
    actions?: ErrorAction[];
    showReport?: boolean;
    showHome?: boolean;
    className?: string;
    size?: "sm" | "md" | "lg" | "xl";
}