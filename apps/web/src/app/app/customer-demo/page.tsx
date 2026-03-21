"use client";

import { useState, useCallback, useEffect } from "react";
import { flushSync } from "react-dom";
import { Telemetry } from "@shared/telemetry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  User,
  Phone,
  Mail,
  ShoppingCart,
  CreditCard,
  Star,
  Package,
  CheckCircle2,
  Activity,
  Eye,
  AlertTriangle,
  Bug,
  Zap,
} from "lucide-react";

/* ─────────────────────── fake product catalog ─────────────────────── */
const PRODUCTS = [
  { id: "SKU-001", name: "Wireless Earbuds Pro", price: 79.99, img: "🎧" },
  { id: "SKU-002", name: "Smart Watch Ultra", price: 249.99, img: "⌚" },
  { id: "SKU-003", name: "Portable Charger 20K", price: 39.99, img: "🔋" },
  { id: "SKU-004", name: "Noise-Cancel Headphones", price: 199.99, img: "🎵" },
  { id: "SKU-005", name: "USB-C Hub 7-in-1", price: 54.99, img: "🔌" },
  { id: "SKU-006", name: "Mechanical Keyboard", price: 129.99, img: "⌨️" },
];

/* ─────────────────────── intentional bugs for demo ─────────────────────── */

/** BUG #1 — Discount coupon that sometimes throws a runtime error */
function applyDiscount(total: number, code: string): number {
  if (code === "CRASH") {
    // Simulated crash: accessing property of undefined
    const obj: any = undefined;
    return obj.discount; // 💥 TypeError: Cannot read properties of undefined
  }
  if (code === "SAVE10") return total * 0.9;
  if (code === "HALF") return total * 0.5;
  return total; // unknown code — no discount
}


/** BUG #3 — Price display function that intermittently shows wrong values */
function formatPrice(price: number): string {
  // BUG: floating point rounding issue — 39.99 * 3 = 119.96999…
  return "$" + price.toString(); // no toFixed — shows ugly decimals sometimes
}

export default function CustomerDemoPage() {
  /* ── identity state ── */
  const [customerId, setCustomerId] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [identified, setIdentified] = useState(false);

  /* ── demo interaction state ── */
  const [cart, setCart] = useState<{ id: string; name: string; price: number; qty: number }[]>([]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [activeTab, setActiveTab] = useState("products");

  /* ── bug demo state ── */
  const [couponCode, setCouponCode] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [jsError, setJsError] = useState<string | null>(null);
  const [flickerCount, setFlickerCount] = useState(0);
  const [isFlickering, setIsFlickering] = useState(false);
  const [isCrashed, setIsCrashed] = useState(false);
  const [crashMessage, setCrashMessage] = useState("");

  /* ── session id ── */
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    setSessionId(Telemetry.getSessionId());
  }, [identified]);

  /* ─────────────────────── handlers ─────────────────────── */
  const handleIdentify = useCallback(() => {
    if (!customerId && !phone && !email) return;
    Telemetry.setUser({
      id: customerId || undefined,
      phone: phone || undefined,
      email: email || undefined,
      username: fullName || undefined,
      customer_id: customerId || undefined,
    });
    setIdentified(true);
    setSessionId(Telemetry.getSessionId());
  }, [customerId, phone, email, fullName]);

  const addToCart = useCallback((product: (typeof PRODUCTS)[0]) => {
    setCart((prev) => {
      const existing = prev.find((p) => p.id === product.id);
      if (existing) return prev.map((p) => (p.id === product.id ? { ...p, qty: p.qty + 1 } : p));
      return [...prev, { id: product.id, name: product.name, price: product.price, qty: 1 }];
    });
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((p) => p.id !== productId));
  }, []);

  const setRating = useCallback((productId: string, rating: number) => {
    setRatings((prev) => ({ ...prev, [productId]: rating }));
  }, []);

  const placeOrder = useCallback(() => {
    if (cart.length === 0) return;
    setOrderPlaced(true);
    setCart([]);
    setTimeout(() => setOrderPlaced(false), 4000);
  }, [cart]);

  /* ── BUG #1: Apply coupon (may crash) ── */
  const handleApplyCoupon = useCallback(() => {
    setCouponError(null);
    setJsError(null);
    try {
      const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
      const discounted = applyDiscount(total, couponCode.toUpperCase());
      if (discounted === total && couponCode) {
        setCouponError(`Invalid coupon code: "${couponCode}"`);
      }
    } catch (err: any) {
      // BUG: error is caught but displayed in an ugly way — visible in replay
      setJsError(`💥 Runtime Error: ${err.message}`);
      console.error("[Customer Demo] Coupon crash:", err);
    }
  }, [cart, couponCode]);

  /* ── BUG #4: UI flicker simulation ── */
  const triggerFlicker = useCallback(() => {
    setFlickerCount((c) => c + 1);
    // Use flushSync + recursive setTimeout so each DOM mutation is visible to
    // rrweb's MutationObserver — React 18 batches setState in setInterval,
    // which would collapse all updates into one and produce no visible flicker.
    let i = 0;
    const step = () => {
      if (i >= 10) {
        flushSync(() => setIsFlickering(false));
        return;
      }
      flushSync(() => setIsFlickering((v) => !v));
      i++;
      setTimeout(step, 200);
    };
    setTimeout(step, 0);
  }, []);

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);

  /* ─────────────────────── UI ─────────────────────── */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* ── Floating session badge ── */}
      <div className="fixed bottom-4 right-4 z-50">
        <Badge
          variant="outline"
          className="bg-slate-900 text-white border-none px-3 py-2 shadow-lg text-[11px] font-mono flex items-center gap-2"
        >
          <Activity className="w-3 h-3 text-green-400 animate-pulse" />
          {sessionId ? `SID: ${sessionId.slice(0, 12)}…` : "Not recording"}
          {identified && <span className="text-green-400 ml-1">• identified</span>}
        </Badge>
      </div>

      <div className="container mx-auto max-w-5xl py-10 px-4 space-y-8">
        {/* ── Header ── */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
            Customer Demo App
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Simulate a real customer journey with <strong>intentional bugs</strong>. Identify yourself,
            browse products, trigger errors, and then watch the replay to see exactly how the bugs
            manifest.
          </p>
        </div>

        {/* ── Step 1: Identity ── */}
        <Card className={`border-2 transition-all ${identified ? "border-green-500/30 bg-green-50/20" : "border-blue-500/20"}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-blue-500" />
                <CardTitle className="text-lg">Step 1 — Identify Customer</CardTitle>
              </div>
              {identified && (
                <Badge className="bg-green-500 text-white">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Identified
                </Badge>
              )}
            </div>
            <CardDescription>
              Fill in at least one field and click Identify. This calls{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">Telemetry.setUser()</code> to
              link the session replay to a customer profile.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1">
                  <User className="w-3 h-3" /> Customer ID
                </label>
                <Input placeholder="e.g. CUS-12345" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Phone
                </label>
                <Input placeholder="e.g. +84 912 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Email
                </label>
                <Input type="email" placeholder="user@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1">
                  <User className="w-3 h-3" /> Full Name
                </label>
                <Input placeholder="Nguyễn Văn A" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
            </div>
            <Button className="mt-4 w-full sm:w-auto" onClick={handleIdentify} disabled={!customerId && !phone && !email}>
              {identified ? "Update Identity" : "Identify Customer"}
            </Button>
          </CardContent>
        </Card>

        {/* ── Step 2: Browse & Cart ── */}
        <Card className="border-2 border-slate-200 relative overflow-hidden">
          {/* Crash overlay — visible in replay as a clear visual break */}
          {isCrashed && (
            <div className="absolute inset-0 z-20 bg-red-50 border-2 border-red-400 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-red-100 border-2 border-red-400 flex items-center justify-center">
                <Bug className="w-7 h-7 text-red-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-red-700 mb-1">Unhandled TypeError</h3>
                <p className="font-mono text-sm text-red-600 bg-red-100 px-3 py-1 rounded border border-red-300 inline-block mb-3">
                  {crashMessage}
                </p>
                <p className="text-xs text-red-500">
                  at applyDiscount (customer-demo/page.tsx:43)<br />
                  at handleApplyCoupon (customer-demo/page.tsx:133)<br />
                  at HTMLButtonElement.onClick
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-red-400 text-red-600 hover:bg-red-100"
                onClick={() => { setIsCrashed(false); setCrashMessage(""); }}
              >
                Dismiss Error
              </Button>
            </div>
          )}
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-violet-500" />
              <CardTitle className="text-lg">Step 2 — Browse &amp; Interact</CardTitle>
              {cartCount > 0 && (
                <Badge variant="secondary" className="ml-auto">
                  <ShoppingCart className="w-3 h-3 mr-1" /> {cartCount} items · ${cartTotal.toFixed(2)}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="products">
                  <Package className="w-3.5 h-3.5 mr-1.5" /> Products
                </TabsTrigger>
                <TabsTrigger value="cart">
                  <ShoppingCart className="w-3.5 h-3.5 mr-1.5" /> Cart ({cartCount})
                </TabsTrigger>
              </TabsList>

              {/* ── Products Grid ── */}
              <TabsContent value="products" className="m-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {PRODUCTS.map((product) => (
                    <div
                      key={product.id}
                      className={`group relative border rounded-xl p-4 hover:shadow-md transition-all hover:border-blue-300 cursor-pointer bg-white ${
                        isFlickering ? "opacity-0" : "opacity-100"
                      }`}
                      style={{ transition: isFlickering ? "none" : "opacity 150ms" }}
                    >
                      <div className="text-4xl mb-3">{product.img}</div>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-sm">{product.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{product.id}</p>
                        </div>
                        {/* BUG #3: Uses formatPrice which doesn't toFixed */}
                        <p className="font-bold text-blue-600">{formatPrice(product.price)}</p>
                      </div>
                      {/* Star rating */}
                      <div className="flex items-center gap-0.5 mt-3">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button key={star} onClick={() => setRating(product.id, star)} className="focus:outline-none">
                            <Star
                              className={`w-4 h-4 transition-colors ${
                                (ratings[product.id] ?? 0) >= star
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-slate-300 hover:text-amber-300"
                              }`}
                            />
                          </button>
                        ))}
                        {ratings[product.id] && (
                          <span className="text-[10px] text-muted-foreground ml-1">({ratings[product.id]}/5)</span>
                        )}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" className="flex-1 text-xs" onClick={() => addToCart(product)}>
                          <ShoppingCart className="w-3 h-3 mr-1" /> Add
                        </Button>
                        <Button size="sm" variant="ghost" className="text-xs">
                          <Eye className="w-3 h-3 mr-1" /> View
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* ── Cart ── */}
              <TabsContent value="cart" className="m-0">
                {cart.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>Your cart is empty. Browse products and add some items!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cart.map((item) => (
                      <div key={item.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border">
                        <div>
                          <p className="font-medium text-sm">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.qty} × {formatPrice(item.price)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {/* BUG #3: subtotal without rounding */}
                          <p className="font-bold text-sm">{formatPrice(item.price * item.qty)}</p>
                          <Button size="sm" variant="ghost" className="text-destructive text-xs h-7" onClick={() => removeFromCart(item.id)}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}

                    {/* ── Coupon code (BUG #1) ── */}
                    <div className="pt-3 border-t space-y-2">
                      <label className="text-xs font-medium flex items-center gap-1">
                        <Zap className="w-3 h-3" /> Coupon Code
                        <span className="text-muted-foreground ml-1">(try: SAVE10, HALF, or CRASH)</span>
                      </label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Enter coupon..."
                          value={couponCode}
                          onChange={(e) => setCouponCode(e.target.value)}
                          className="max-w-xs"
                        />
                        <Button size="sm" variant="secondary" onClick={handleApplyCoupon}>
                          Apply
                        </Button>
                      </div>
                      {couponError && (
                        <p className="text-sm text-amber-600 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> {couponError}
                        </p>
                      )}
                      {jsError && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                          <p className="text-sm text-red-700 font-mono flex items-center gap-1.5">
                            <Bug className="w-4 h-4 text-red-500" /> {jsError}
                          </p>
                          <p className="text-xs text-red-500 mt-1">
                            This crash is intentional — check the session replay to see how it appears to the user.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t">
                      <p className="font-bold text-lg">Total: ${cartTotal.toFixed(2)}</p>
                      <Button
                        size="lg"
                        className="bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                        onClick={placeOrder}
                      >
                        <CreditCard className="w-4 h-4 mr-2" /> Place Order
                      </Button>
                    </div>
                  </div>
                )}

                {orderPlaced && (
                  <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg text-center animate-in fade-in">
                    <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                    <p className="font-semibold text-green-700">Order Placed Successfully!</p>
                    <p className="text-xs text-green-600 mt-1">
                      This interaction is now captured in the session replay.
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* ── Step 3: Bug Triggers ── */}
        <Card className="border-2 border-red-200/50 bg-red-50/20">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Bug className="w-5 h-5 text-red-500" />
              <CardTitle className="text-lg">Step 3 — Trigger Bugs</CardTitle>
              <Badge variant="destructive" className="text-[10px] ml-auto">Intentional Bugs</Badge>
            </div>
            <CardDescription>
              These buttons trigger intentional UI bugs. After interacting, go to{" "}
              <a href="/admin/replays" className="underline text-blue-500 hover:text-blue-700">
                Admin Replays
              </a>{" "}
              to watch the replay and see exactly how these bugs appear to users.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* BUG #1: Runtime crash */}
              <div className="p-4 border rounded-lg bg-white space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive" className="text-[10px]">#1</Badge>
                  <p className="font-semibold text-sm">Runtime Crash</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Simulates an unhandled TypeError that breaks the checkout flow visually.
                </p>
                <Button
                  size="sm"
                  variant="destructive"
                  className="w-full"
                  onClick={() => {
                    try {
                      applyDiscount(100, "CRASH");
                    } catch (err: any) {
                      setCrashMessage(err.message);
                      setIsCrashed(true);
                    }
                  }}
                >
                  <Zap className="w-3 h-3 mr-1" /> Trigger Crash
                </Button>
              </div>

              {/* BUG #4: UI Flicker */}
              <div className="p-4 border rounded-lg bg-white space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive" className="text-[10px]">#2</Badge>
                  <p className="font-semibold text-sm">UI Flicker / Jank</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Products will rapidly appear and disappear — visible in replay.
                </p>
                <Button size="sm" variant="destructive" className="w-full" onClick={triggerFlicker}>
                  <AlertTriangle className="w-3 h-3 mr-1" /> Trigger Flicker ({flickerCount})
                </Button>
              </div>

              {/* BUG #5: Infinite loading state */}
              <div className="p-4 border rounded-lg bg-white space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive" className="text-[10px]">#3</Badge>
                  <p className="font-semibold text-sm">Frozen UI</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Blocks the main thread for 3 seconds — UI becomes unresponsive.
                </p>
                <Button
                  size="sm"
                  variant="destructive"
                  className="w-full"
                  onClick={() => {
                    // Intentional: synchronous block to simulate a frozen UI
                    const start = Date.now();
                    while (Date.now() - start < 3000) {
                      // busy wait — UI is fully frozen, visible in replay as a "dead zone"
                    }
                  }}
                >
                  <Bug className="w-3 h-3 mr-1" /> Freeze 3s
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Footer ── */}
        <div className="text-center text-xs text-muted-foreground space-y-1">
          <p>
            Every click, scroll, error, and UI glitch on this page is recorded by the{" "}
            <strong>Telemetry SDK</strong> and can be replayed in the{" "}
            <a href="/admin/replays" className="underline text-blue-500 hover:text-blue-700">
              Admin Replay Portal
            </a>
            .
          </p>
          <p className="font-mono opacity-50">Session: {sessionId ?? "initializing…"}</p>
        </div>
      </div>
    </div>
  );
}
