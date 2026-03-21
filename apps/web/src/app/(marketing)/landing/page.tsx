import { Navbar } from "../components/Navbar";
import { HeroSection } from "../components/HeroSection";
import { TrustBar } from "../components/TrustBar";
import { FeaturesSection } from "../components/FeaturesSection";
import { HowItWorks } from "../components/HowItWorks";
import { PricingSection } from "../components/PricingSection";
import { CtaSection } from "../components/CtaSection";
import { Footer } from "../components/Footer";

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <HeroSection />
      <TrustBar />
      <FeaturesSection />
      <HowItWorks />
      <PricingSection />
      <CtaSection />
      <Footer />
    </>
  );
}
