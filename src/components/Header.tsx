import React from 'react';
import { Shield } from 'lucide-react';

export const Header: React.FC = () => {
  return (
    <header className="flex items-center gap-2 p-4 bg-indigo-600 text-white shadow-md">
      <Shield className="w-6 h-6" />
      <h1 className="text-xl font-bold tracking-tight">PrivacyLens</h1>
    </header>
  );
};
