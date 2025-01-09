import HeroOther from "../sections/HeroOther";
import NavBar from "../components/Navbar";
import Footer from "../components/footer";
import AboutSection from "../sections/AboutSection";
function About() {
  return(
    <>
    <NavBar active="about"/>
    <HeroOther title="Know More About" words={["Us", "Our Company", "Our Team", "Our Work", "Our Founders"]} />
    <AboutSection />
    <Footer />
    </>
  );
}


export default About