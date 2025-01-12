import NavBar from "../components/Navbar";
import { Helmet } from "react-helmet";
function Business() {
      return (
         <>
         <Helmet>
            <title>Best Networking Solution for your Business - IntroTaps</title>
         </Helmet>
         <NavBar active="businesses" />
         <div>
               <h1>For Teams</h1>
         </div>
         </>
      );
}
export default Business;