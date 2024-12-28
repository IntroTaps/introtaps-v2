import { Link } from 'react-router-dom';
import Bif from '../functions/IconFlled';
function CardOptions() {
    return (
        <div className="container mt-5">
            <div className="row mt-5 d-flex align-items-center">
                <div className="col">
                    <h1 className="heading-bold-2">
                      <b>  Card Options</b>
                    </h1>
                </div>
                <div className="col text-end">
                    <Link className="btn btn-primary btn-lg" to="/shop">Buy Now</Link>
                </div>
            </div>
            <div className="container">
                <div className="row mt-2">
                    {cardData.map((card, index) => (
                        <div key={index} className={`col-lg-4 mb-2 d-flex  justify-content-${card.justify}`}>
                            <div className="card-card text-center shadow-lg">
                                <img src={card.imgSrc} alt={card.imgAlt} className="imgcardoptions" />
                                <div className="mt-3">
                                    <h4><b>{card.title}</b> <Link  to="shop" className="btn btn-primary"><Bif i="arrow-up-right-circle"></Bif></Link></h4>
                                    <p className='text-white-50'>{card.description}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="row">
                    <div className="col-lg-12 " >
                        <div className="card-card-h shadow-lg" >
                            <div className="row mt-1" >
                                <div className="col-lg-12">
                            
                                    <h1><b>IntroTaps For Teams</b></h1>
                                    <p className='text-white-50'>Effortlessly manage your team's cards through our portal. Easily update and control card details, ensuring employees cannot alter their card information. Contact us for customized plans tailored to your team's needs.</p>
                                    <Link className="btn btn-primary " to="/">Get Started</Link>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

const cardData = [
    {
        imgSrc: "/standard-card.png",
        imgAlt: "Standard Card",
        title: "Standard",
        description: "Standard Card comes with all of the essential features. It is the most Budget Friendly way to shift to eco friendly solution. Packed with features, it comes with 3 profile themes, upto 10 leads and upto 8 Social Links",
        justify: "center",
    },
    {
        imgSrc: "/img/customcard.gif",
        imgAlt: "Custom Card",
        title: "Custom",
        description: "Customize your card according to you needs. For those who want everything customized to match their personality. A budget friendly Customizable card with all features included in standard card",
        justify: "center"
    },
    {
        imgSrc: "/img/cardpremium.png",
        imgAlt: "Premium Card",
        title: "Premium",
        description: "For those who want to Stand Out. Enjoy Exclusive features including but not limited to More than 6 themes, Unlimited Leads,  Customized Design, 24/7 Support and more",
        justify: "center"
    }
];

export default CardOptions;