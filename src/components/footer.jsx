import { Link } from "react-router";
import Bi from "../functions/Icons";
import Bif from "../functions/IconFlled";
function Footer() {
    return (
        <footer className="footer">
           <div className="container">
            <div className="row mt-5">
                <div className="col-lg-3">
                    <img src="/logo-dark.png" alt="" height={50} />
                    <p>Pioneering World's Premier NFC Brand With Global Quality Standards</p>
                    <ul className="footer-lists">
                        <li><Bif i="geo-alt" s="text-green"/> MM Alam Road, Multan</li>
                        <li><Bif i="envelope-at" s="text-green"/> info@introtaps.com</li>
                        <li><Bif i="telephone" s="text-green"/> +92 312 6919489</li>
                      
                    </ul>
                    <img src="/appicons.png" height={70} alt="" />
                </div>
            
                <div className="col-lg-3">
                    <h5>Quick Links</h5>
                    <hr className="text-green border-4 rounded opacity-100" style={{width: '20%'}}/>
                    <ul className="footer-lists">
                        <li><Bif i="caret-right" s="text-green"/> <Link to="/shipping-policy">Home</Link></li>
                        <li><Bif i="caret-right" s="text-green"/> <Link to="/blog">Products</Link></li>
                        <li><Bif i="caret-right" s="text-green"/> <Link to="/affiliates">Your Dashboard</Link></li>
                        <li><Bif i="caret-right" s="text-green"/> <Link to="/notable-clients">About Us</Link></li>
                        <li><Bif i="caret-right" s="text-green"/> <Link to="/privacy-policy">Contact</Link></li>
                        <li><Bif i="caret-right" s="text-green"/> <Link to="/terms-and-conditions">FAQs</Link></li>
                        <li><Bif i="caret-right"s="text-green" /> <Link to="/site-map">Partnership Request</Link></li>
                    </ul>
                </div>
                <div className="col-lg-3">
                    <h5>Company</h5>
                    <hr className="text-green border-4 rounded opacity-100" style={{width: '20%'}}/>
                    <ul className="footer-lists">
                        <li><Bif i="caret-right" s="text-green"/> <Link to="/shipping-policy">Shipping Policy</Link></li>
                        <li><Bif i="caret-right"s="text-green" /> <Link to="/blog">Blog</Link></li>
                        <li><Bif i="caret-right" s="text-green"/> <Link to="/affiliates">Affiliates</Link></li>
                        <li><Bif i="caret-right" s="text-green"/> <Link to="/notable-clients">Notable Clients</Link></li>
                        <li><Bif i="caret-right"s="text-green" /> <Link to="/privacy-policy">Privacy Policy</Link></li>
                        <li><Bif i="caret-right"s="text-green" /> <Link to="/terms-and-conditions">Terms and Conditions</Link></li>
                        <li><Bif i="caret-right" s="text-green"/> <Link to="/site-map">SiteMap</Link></li>
                    </ul>
                </div>
            </div>
           </div>
        </footer>
    );

}
export default Footer;