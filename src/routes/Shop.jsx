import NavBar from "../components/Navbar";
import { Helmet } from "react-helmet";
function Shop() {
      return (
         <>
         <Helmet>
            <title>Shop - IntroTaps</title>
         </Helmet>
         <NavBar active="shop" />
         <div>
               <h1>Shop</h1>
         </div>
         </>
      );
}
export default Shop;