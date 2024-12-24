import Hero from "../sections/Hero";
import Section2 from "../sections/Section2";
import Section3 from "../sections/Section3";
import Section4 from "../sections/Section4";
import Brands from "../sections/Brands";
import CardOptions from "../sections/CardOptions";
import Footer from "../components/footer";
import '../App.css'

function Home() {
  return (
   <>
      <Hero />
      <Section2 />
      <Section3 />
      <Brands />
      <CardOptions />
      <Section4 />
      <Footer />
   </>
  );
}
export default Home;