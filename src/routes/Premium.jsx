import NavBar from "../components/NavBar"
import Footer from "../components/footer"
import HeroOther from "../sections/HeroOther"
function Premium() {
  return(
    <>
      <NavBar active="shop"/>
      <HeroOther type="premium" title="Premium Is" words={["Exclusive", "Standing Out", "Unique", "Expensive", "Modern"]} tagline="Experience the ease of Networking with IntroTaps Standard NFC Card" />
      <Footer />
    </>
  )
}

export default Premium