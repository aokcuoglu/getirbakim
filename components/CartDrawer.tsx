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
        className={`fixed inset-0 bg-primary/10 z-50 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div className={`fixed top-0 right-0 h-full w-full max-w-md bg-background border-l border-border shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Cart ({items.length})</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Progress Bar - Technical Style */}
        <div className="px-6 py-4 bg-muted border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
               Shipping Status
            </span>
            <span className="text-xs text-muted-foreground">
               {progress.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {remaining > 0 
              ? `Add ${remaining.toFixed(2)} for free shipping`
              : "Free shipping unlocked"}
          </p>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4">
              <div className="w-12 h-12 rounded-lg bg-muted border border-border flex items-center justify-center">
                <Gift size={20} />
              </div>
              <p className="text-sm">Your cart is empty.</p>
              <GlassButton variant="outline" onClick={onClose}>Continue Shopping</GlassButton>
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="flex gap-4">
                <div className="w-20 h-20 rounded-md bg-muted border border-border flex items-center justify-center shrink-0">
                  <img src={item.imageUrl} alt={item.name} className="w-16 h-16 object-cover mix-blend-multiply" />
                </div>
                
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start">
                       <h4 className="font-medium text-foreground text-sm leading-tight">{item.name}</h4>
                       <button 
                        onClick={() => onRemove(item.id)}
                        className="text-muted-foreground/70 hover:text-destructive transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{item.brand}</p>
                  </div>

                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center border border-border rounded-md bg-background">
                      <button 
                        onClick={() => onUpdateQty(item.id, -1)}
                        className="w-7 h-7 flex items-center justify-center hover:bg-muted text-muted-foreground"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="text-xs font-medium w-6 text-center text-foreground">{item.quantity}</span>
                      <button 
                         onClick={() => onUpdateQty(item.id, 1)}
                         className="w-7 h-7 flex items-center justify-center hover:bg-muted text-muted-foreground"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <span className="font-bold text-foreground text-sm">{(item.price * item.quantity).toFixed(2)} TRY</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="p-6 bg-background border-t border-border">
            <div className="flex justify-between items-center mb-4 text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-bold text-foreground">{total.toFixed(2)} TRY</span>
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
