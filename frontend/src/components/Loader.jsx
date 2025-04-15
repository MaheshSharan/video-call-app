import React from 'react';

const Loader = () => {
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-indigo-900 to-blue-900 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
        <p className="text-indigo-200 text-lg font-medium">Connecting to meeting...</p>
      </div>
    </div>
  );
};

export default Loader; 