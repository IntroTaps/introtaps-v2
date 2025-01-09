import { Link } from "react-router";
import Bi from "../functions/Icons";
import Bif from "../functions/IconFlled";
import React from "react";

const FooterLink = React.memo(({ to, icon, children, external }) => (
    <li>
        <Bif i={icon} s="text-green" />
        {external ? (
            <a href={to} target="_blank" rel="noopener noreferrer">{children}</a>
        ) : (
            <Link to={to}>{children}</Link>
        )}
    </li>
));

const FooterSection = React.memo(({ title, links }) => (
    <div className="col-lg-4">
        <h5>{title}</h5>
        <hr className="text-green border-4 rounded opacity-100" style={{ width: '20%' }} />
        <ul className="footer-lists">
            {links.map((link, index) => (
                <FooterLink key={index} {...link} />
            ))}
        </ul>
    </div>
));

function Footer() {
    const quickLinks = [
        { to: "/shipping-policy", icon: "caret-right", children: "Home" },
        { to: "/blog", icon: "caret-right", children: "Products" },
        { to: "/affiliates", icon: "caret-right", children: "Your Dashboard" },
        { to: "/notable-clients", icon: "caret-right", children: "About Us" },
        { to: "/privacy-policy", icon: "caret-right", children: "Contact" },
        { to: "/terms-and-conditions", icon: "caret-right", children: "FAQs" },
        { to: "/site-map", icon: "caret-right", children: "Partnership Request" },
    ];

    const companyLinks = [
        { to: "/shipping-policy", icon: "caret-right", children: "Shipping Policy" },
        { to: "https://introtaps.com/blogs", icon: "caret-right", children: "Blog", external: true },
        { to: "/affiliates", icon: "caret-right", children: "Affiliates" },
        { to: "/notable-clients", icon: "caret-right", children: "Notable Clients" },
        { to: "/privacy-policy", icon: "caret-right", children: "Privacy Policy" },
        { to: "/terms-and-conditions", icon: "caret-right", children: "Terms and Conditions" },
        { to: "/site-map", icon: "caret-right", children: "SiteMap" },
    ];

    const socialLinks = [
        { to: "https://instagram.com/introtaps", icon: "instagram" },
        { to: "https://facebook.com/introtaps", icon: "facebook" },
        { to: "https://linkedin.com/company/introtaps", icon: "linkedin" },
    ];

    return (
        <footer className="footer ">
            <div className="container">
                <div className="row mt-5">
                    <div className="col-lg-4">
                        <img src="/logo-dark.png" alt="" height={50} />
                        <p>Pioneering World's Premier NFC Brand With Global Quality Standards</p>
                        <ul className="footer-lists">
                            <FooterLink to="#" icon="geo-alt" children="MM Alam Road, Multan" />
                            <FooterLink to="mailto:info@introtaps.com" icon="envelope-at" children="info@introtaps.com" external />
                            <FooterLink to="tel:+923126919489" icon="telephone" children="+92 312 6919489" external />
                        </ul>
                        <img src="/appicons.png" height={70} alt="" />
                    </div>
                    <FooterSection title="Quick Links" links={quickLinks} />
                    <FooterSection title="Company" links={companyLinks} />
                </div>
                <div className="row mt-5 align-items-center d-flex justify-content-between">
                    <div className="col col-sm-8 ">
                        <h1 className="heading-bold-1">
                            Order Your Card <b className="text-green">Today.</b>
                        </h1>
                        <Link to="shop" className="btn btn-lg btn-primary">Get Started</Link>
                    </div>
                    <div className="col-sm-4">
                        <div className="row ">
                            <div className="col text-center mt-3"> 
                                {socialLinks.map((link, index) => (
                                    <Link key={index} to={link.to} target="_blank">
                                        <Bi i={link.icon} s={`heading-bold-1 ${index > 0 ? 'ms-5' : ''} text-green`} />
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
                <hr className="line-seperator mt-5" />
                <div className="row align-items-center justify-content-between">
                    <div className="col text-white-50 text-center">2024 &copy; All Rights Reserved | A Project of IntroTaps Technologies &reg;</div>
                </div>
               
            </div>
        </footer>
    );
}

export default React.memo(Footer);