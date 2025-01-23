import NavBar from "../components/NavBar"
import Footer from "../components/footer"
import HeroOther from "../sections/HeroOther"
function Custom() {
  return(
    <>
      <NavBar active="shop"/>
      <HeroOther title="Custom Means" words={["For You", "Personalized", "Tweakable", "Preferred", "Worthy"]} tagline="Experience the ease of Networking with IntroTaps Standard NFC Card" />
      <Footer />
    </>
  )
}

export default Custom