import Hero from "../sections/Hero";
import Section2 from "../sections/Section2";
import Section3 from "../sections/Section3";
import Section4 from "../sections/Section4";
import Brands from "../sections/Brands";
import CardOptions from "../sections/CardOptions";
import Footer from "../components/footer";
import Navbar from "../components/Navbar";
import Statstripe from "../sections/Statstripe";
import CustomCard from "../sections/CustomCard";
import { Helmet } from "react-helmet";
function Home() {
  return (
   <>
   <Helmet>
    <title>IntroTaps - Digital Business Cards For Everyone</title>
   </Helmet>
      <Navbar active="home"/>
      <Hero />
      <Section2 />
      <Section3 />
      <Brands />
      <CardOptions />
      <Statstripe />
      <CustomCard/>
      <Section4 />
      <Footer />
   </>
  );
}
export default Home;