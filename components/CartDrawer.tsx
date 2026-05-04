import React, { useMemo } from 'react';
import { X, Trash2, ArrowRight, Gift, Minus, Plus } from 'lucide-react';
import { CartItem } from '../types';
import { FREE_SHIPPING_THRESHOLD } from '../constants';
import { GlassButton } from './Glass';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  onRemove: (id: string) => void;
  onUpdateQty: (id: string, delta: number) => void;
  onCheckout?: () => void;
}

const CartDrawer: React.FC<CartDrawerProps> = ({ 
  isOpen, 
  onClose, 
  items, 
  onRemove,
  onUpdateQty,
  onCheckout
}) => {
  const total = useMemo(() => items.reduce((sum, item) => sum + (item.price * item.quantity), 0), [items]);
  const progress = Math.min((total / FREE_SHIPPING_THRESHOLD) * 100, 100);
  const remaining = Math.max(FREE_SHIPPING_THRESHOLD - total, 0);

  return (
    <>
      {/* Backdrop - minimal darkness */}
      <div 
        className={`fixed inset-0 bg-slate-900/10 z-50 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div className={`fixed top-0 right-0 h-full w-full max-w-md bg-white border-l border-slate-200 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Cart ({items.length})</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Progress Bar - Technical Style */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
               Shipping Status
            </span>
            <span className="text-xs text-slate-500 font-mono">
               {progress.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-slate-900 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {remaining > 0 
              ? `Add ${remaining.toFixed(2)} for free shipping`
              : "Free shipping unlocked"}
          </p>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
              <div className="w-12 h-12 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center">
                <Gift size={20} />
              </div>
              <p className="text-sm">Your cart is empty.</p>
              <GlassButton variant="outline" onClick={onClose}>Continue Shopping</GlassButton>
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="flex gap-4">
                <div className="w-20 h-20 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                  <img src={item.imageUrl} alt={item.name} className="w-16 h-16 object-cover mix-blend-multiply" />
                </div>
                
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start">
                       <h4 className="font-medium text-slate-900 text-sm leading-tight">{item.name}</h4>
                       <button 
                        onClick={() => onRemove(item.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{item.brand}</p>
                  </div>

                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center border border-slate-200 rounded-md bg-white">
                      <button 
                        onClick={() => onUpdateQty(item.id, -1)}
                        className="w-7 h-7 flex items-center justify-center hover:bg-slate-50 text-slate-600"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="text-xs font-medium w-6 text-center text-slate-900">{item.quantity}</span>
                      <button 
                         onClick={() => onUpdateQty(item.id, 1)}
                         className="w-7 h-7 flex items-center justify-center hover:bg-slate-50 text-slate-600"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <span className="font-bold text-slate-900 text-sm">{(item.price * item.quantity).toFixed(2)} TRY</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="p-6 bg-white border-t border-slate-200">
            <div className="flex justify-between items-center mb-4 text-sm">
              <span className="text-slate-500">Subtotal</span>
              <span className="font-bold text-slate-900 font-mono">{total.toFixed(2)} TRY</span>
            </div>
            <GlassButton
              className="w-full h-11 flex items-center justify-center gap-2"
              onClick={() => onCheckout?.()}
            >
              Checkout <ArrowRight size={16} />
            </GlassButton>
          </div>
        )}
      </div>
    </>
  );
};

export default CartDrawer;
