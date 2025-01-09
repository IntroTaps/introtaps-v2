import { Helmet } from 'react-helmet';
import NavBar from '../components/Navbar';
import Footer from '../components/footer';
import HeroOther from '../sections/HeroOther';
import CardOptions from '../sections/CardOptions';


function Shop() {
      return (
            <>
                  <Helmet>
                        <title>Shop - IntroTaps</title>
                  </Helmet>
                  <NavBar active="shop" />
                  <HeroOther title="It's All About" words={["Future", "2025", "Nature", "Time", "Networking", "Modernism", "Simplicity"]} tagline="Shop From Our All Inclusive Collection Below"/>
                  <CardOptions />
                  <Footer />
            </>
      );
}

export default Shop;