import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle } from 'lucide-react';

interface Props {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ConfirmationModal({ isOpen, title, message, onConfirm, onCancel }: Props) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const titleId = React.useId();
  const messageId = React.useId();

  // Reset state when modal opens/closes
  React.useEffect(() => {
    if (!isOpen) setIsSubmitting(false);
  }, [isOpen]);

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirm();
    } finally {
      // it closes anyway, but just in case
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" role="presentation">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-sm bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-zinc-800"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={messageId}
          >
            <div className="flex items-center gap-3 mb-4 text-amber-500">
              <AlertCircle className="w-8 h-8" />
              <h3 id={titleId} className="text-xl font-bold text-white">{title}</h3>
            </div>
            <p id={messageId} className="text-zinc-400 mb-6">{message}</p>
            <div className="flex gap-3">
              <button 
                onClick={onCancel}
                className="flex-1 py-3 rounded-xl font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
              >
                Hủy
              </button>
              <button 
                onClick={handleConfirm}
                disabled={isSubmitting}
                className="flex-1 py-3 rounded-xl font-medium text-white bg-pink-500 hover:bg-pink-600 transition-colors shadow-[0_0_15px_rgba(255,0,127,0.4)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Đang xử lý...' : 'Xác nhận'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
