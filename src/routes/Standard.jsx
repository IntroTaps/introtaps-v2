import NavBar from "../components/NavBar"
import Footer from "../components/footer"
import HeroOther from "../sections/HeroOther"
function StandardCard() {
  return(
    <>
      <NavBar active="shop"/>
      <HeroOther title="Standard Isn't Always" words={["Standard", "Ordinary", "Cheap", "Unuseful", "Simple"]} tagline="Experience the ease of Networking with IntroTaps Standard NFC Card" />
      <Footer />
    </>
  )
}

export default StandardCard